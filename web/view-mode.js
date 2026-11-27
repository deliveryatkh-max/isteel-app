/**
 * 📱 / 🖥️ switch next to the language button (Kim, 13 Nov 2026), in every app.
 * Phone look on a computer: the app opens in a phone-sized frame in the middle of the screen.
 * Computer look on a phone: the page is drawn 1280px wide (pinch to zoom).
 * The choice is remembered on this device (localStorage isteel_view); picking the device's own look clears it.
 * Load it in <head> (it must run before the page body): <script src="../view-mode.js"></script>
 * Header (Kim, 13 Nov 2026, option B): one ⚙️ button in the bar; language, phone/computer and dark mode sit in its menu.
 * Back ‹ and Forward › buttons left of ⚙️ on every screen of every app (Kim, 17 Nov 2026).
 */
(function () {
  const KEY = 'isteel_view';
  const get = () => { try { return localStorage.getItem(KEY) || ''; } catch (e) { return ''; } };
  const put = v => { try { if (v) localStorage.setItem(KEY, v); else localStorage.removeItem(KEY); } catch (e) { /* private window */ } };
  const mode = get();
  // Inside the phone frame: also true after moving to another app inside it (that page has no ?vm=in), so the
  // 🖥️ button reloads the whole window and not only the frame (Kim, 14 Nov 2026: "switch back to desktop doesn't work").
  const inFrame = (() => { try { return window !== window.top && !!window.top.document.getElementById('vmFrame'); } catch (e) { return false; } })();
  // Phones and tablets (touch screen up to tablet size): the computer look widens the page instead of framing it.
  const phoneDevice = Math.min(screen.width, screen.height) < 1100 && matchMedia('(pointer: coarse)').matches;

  // Phone look on a computer: the rest of this page is not run; a frame loads the same page at phone width.
  if (mode === 'mobile' && !inFrame && window === window.top && !phoneDevice) {
    const u = new URL(location.href);
    u.searchParams.set('vm', 'in');
    document.write('<style>html,body{margin:0;height:100%;background:#0b1a2e}body{display:flex;justify-content:center;align-items:stretch}' +
      '#vmFrame{position:fixed;top:0;bottom:0;left:50%;transform:translateX(-50%);width:min(430px,100%);height:100%;border:0;background:#fff;box-shadow:0 0 0 1px rgba(255,255,255,.08),0 20px 60px rgba(0,0,0,.45)}</style>' +
      '<iframe id="vmFrame" title="Phone view" src="' + u.href.replace(/"/g, '&quot;') + '"></iframe><plaintext hidden>');
    return;
  }
  // Computer look on a phone.
  if (mode === 'desktop' && phoneDevice && !inFrame) {
    const m = document.querySelector('meta[name="viewport"]');
    if (m) m.setAttribute('content', 'width=1280, viewport-fit=cover');
  }

  // What the screen shows now: the apps switch to the computer layout at 900px.
  const looksPhone = () => inFrame || window.innerWidth < 900;
  function pick(v) {
    const natural = phoneDevice ? 'mobile' : 'desktop';
    put(v === natural ? '' : v);
    if (v === 'desktop' && !inFrame && !phoneDevice) {   // a computer window narrower than 900px: only a wider window helps
      const n = document.createElement('div');
      n.textContent = window.LANG ? LANG.t('សូមពង្រីកផ្ទាំងកម្មវិធីរុករកឱ្យធំជាងនេះ', 'Make the browser window wider') : 'សូមពង្រីកផ្ទាំងកម្មវិធីរុករកឱ្យធំជាងនេះ';
      n.style.cssText = 'position:fixed;left:50%;bottom:90px;transform:translateX(-50%);z-index:1001;background:#011e41;color:#fff;padding:10px 16px;border-radius:12px;font:14px system-ui,sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.3)';
      document.body.appendChild(n); setTimeout(() => n.remove(), 3000);
      return;
    }
    if (inFrame) window.top.location.reload(); else location.reload();
  }
  function addButton() {
    if (document.getElementById('vmSw')) return;
    const lang = document.getElementById('langBtn') || document.querySelector('.lang-btn');
    if (!lang || !lang.parentNode) return;
    const st = document.createElement('style');
    st.textContent = '.vm-sw{display:inline-flex;flex:none;align-items:stretch;height:34px;border:1px solid rgba(255,255,255,.35);border-radius:999px;overflow:hidden;margin:0 2px;vertical-align:middle}' +
      '.vm-sw button{border:0;margin:0;padding:0 7px;min-width:0;background:transparent;color:#fff;font-size:15px;line-height:1;cursor:pointer;opacity:.55;box-shadow:none;border-radius:0}' +
      '.vm-sw button.on{background:rgba(255,255,255,.22);opacity:1}.vm-sw button:focus-visible{outline:2px solid #61cbf4;outline-offset:-2px}';
    document.head.appendChild(st);
    const w = document.createElement('span');
    w.className = 'vm-sw'; w.id = 'vmSw'; w.setAttribute('role', 'group');
    const ph = looksPhone();
    w.innerHTML = '<button type="button" data-vm="mobile" class="' + (ph ? 'on' : '') + '" title="ទូរស័ព្ទ · Phone view" aria-label="Phone view" aria-pressed="' + ph + '">📱</button>' +
      '<button type="button" data-vm="desktop" class="' + (ph ? '' : 'on') + '" title="កុំព្យូទ័រ · Computer view" aria-label="Computer view" aria-pressed="' + !ph + '">🖥️</button>';
    w.onclick = e => { const b = e.target.closest('[data-vm]'); if (b && !b.classList.contains('on')) pick(b.dataset.vm); };
    lang.parentNode.insertBefore(w, lang.nextSibling);
    buildMenu(lang, w);
    addNav();
    unfreeze();
  }

  /**
   * Phone screens (Kim, 19 Nov 2026): the page scrolls as one piece; nothing freezes except the top bar (‹ › ⚙️)
   * and the bottom menu. Every "position: sticky" rule of the app's own CSS is switched off below 900px, so the
   * computer layout keeps its frozen headers and filters. Tables keep their own sideways scroll.
   */
  function unfreeze() {
    const nav = document.getElementById('vmNav') || document.getElementById('setBtn');
    let bar = nav && nav.parentElement;
    while (bar && bar !== document.body && !/sticky|fixed/.test(getComputedStyle(bar).position)) bar = bar.parentElement;
    if (bar === document.body) bar = null;
    const keep = sel => { try { return bar && (bar.matches(sel) || !!bar.querySelector(sel)); } catch (e) { return true; } };
    const sticky = [], tall = [];
    const POP = /sheet|modal|dialog|menu|pop|drop|sug|toast|lightbox|viewer|picker|opts|combo|overlay|panel|drawer|list|raw|dd\b/i;   // pop-ups keep their own scroll
    const walk = rules => {
      for (const ru of rules) {
        if (ru.cssRules && !ru.selectorText) { walk(ru.cssRules); continue; }
        if (!ru.selectorText || !ru.style) continue;
        const parts = ru.selectorText.split(/,(?![^(]*\))/).map(x => x.trim()).filter(Boolean);
        if (ru.style.position === 'sticky') parts.forEach(x => { if (!keep(x) && !/\.vm-keep\b/.test(x)) sticky.push(x); });   // .vm-keep = Kim asked for this one frozen on phones too
        // Boxes that scroll inside the page (a table capped at 420px high) become full height on a phone.
        const mh = ru.style.maxHeight;
        if (mh && mh !== 'none' && /auto|scroll/.test(ru.style.overflow + ru.style.overflowY) && !/fixed|absolute/.test(ru.style.position)) {
          parts.forEach(x => { if (!POP.test(x)) tall.push(x); });
        }
      }
    };
    for (const sh of document.styleSheets) {
      if (sh.ownerNode && sh.ownerNode.id === 'vmFree') continue;
      let rules; try { rules = sh.cssRules; } catch (e) { continue; }   // a stylesheet from another site
      if (rules) walk(rules);
    }
    let st = document.getElementById('vmFree');
    if (!st) { st = document.createElement('style'); st.id = 'vmFree'; document.head.appendChild(st); }
    st.textContent = '@media (max-width: 899px){' +
      // The app name shrinks with "…" so it never runs under ‹ › ⚙️.
      '.bar .brand{min-width:0;flex:1 1 auto;overflow:hidden}.bar .brand>div:last-child{min-width:0;overflow:hidden}' +
      '.bar .brand>div:last-child>b,.bar .brand>div:last-child>small{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
      '.bar-right,.top-right{flex:none}' +
      (sticky.length ? sticky.join(',') + '{position:static!important}' : '') +
      (tall.length ? tall.join(',') + '{max-height:none!important;overflow-y:visible!important}' : '') + '}';
  }

  /**
   * ‹ Back and › Forward: the browser's own history, so they match the phone's back gesture.
   * Apps with their own screen list (Fuel: #navBack / #navFwd) are driven through those buttons instead.
   * Back with nothing before it (an app opened from a link) goes to the home menu.
   */
  function addNav() {
    if (document.getElementById('vmNav')) return;
    let anchor = document.querySelector('.set-wrap');
    if (!anchor) anchor = reactGear();
    if (!anchor || !anchor.parentNode) return;
    if (!document.getElementById('vmNavCss')) {
      const st = document.createElement('style');
      st.id = 'vmNavCss';
      st.textContent = '.vm-nav{flex:none;display:inline-flex;gap:4px;margin-right:2px}' +
        '.vm-nav button{flex:none;width:32px;height:32px;padding:0;margin:0;border-radius:50%;border:1px solid rgba(255,255,255,.3);background:rgba(255,255,255,.12);color:#fff;display:grid;place-items:center;cursor:pointer;box-shadow:none}' +
        '.vm-nav button:active{background:rgba(255,255,255,.3)}.vm-nav button:disabled{opacity:.35;cursor:default}' +
        '.vm-nav svg{width:18px;height:18px;display:block}' +
        '#navBack,#navFwd{visibility:hidden}';   // Fuel's own row: the bar buttons take over
      document.head.appendChild(st);
    }
    const ic = d => '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="' + d + '" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    const nav = document.createElement('span');
    nav.className = 'vm-nav'; nav.id = 'vmNav';
    nav.innerHTML = '<button type="button" data-nav="back">' + ic('M15 5l-7 7 7 7') + '</button><button type="button" data-nav="fwd">' + ic('M9 5l7 7-7 7') + '</button>';
    anchor.parentNode.insertBefore(nav, anchor);
    const [bb, fb] = nav.querySelectorAll('button');
    const own = k => document.getElementById(k === 'back' ? 'navBack' : 'navFwd');
    const N = window.navigation;
    const isHome = () => /^\/(index\.html)?$/.test(location.pathname);
    const paint = () => {
      bb.title = T('ថយក្រោយ', 'Back'); fb.title = T('ទៅមុខ', 'Forward');
      bb.setAttribute('aria-label', bb.title); fb.setAttribute('aria-label', fb.title);
      const ob = own('back'), of = own('fwd');
      if (ob && of && !ob.closest('[hidden]')) { bb.disabled = ob.disabled && (!N || !N.canGoBack); fb.disabled = of.disabled && (!N || !N.canGoForward); return; }
      bb.disabled = isHome() && !!N && !N.canGoBack;
      fb.disabled = !!N && !N.canGoForward;
    };
    nav.onclick = e => {
      const b = e.target.closest('[data-nav]'); if (!b || b.disabled) return;
      const k = b.dataset.nav, o = own(k);
      if (o && !o.disabled && !o.closest('[hidden]')) return o.click();
      if (k === 'fwd') return history.forward();
      if (N && !N.canGoBack && !isHome()) { location.href = '/'; return; }
      history.back();
    };
    paint();
    if (window.LANG && LANG.onChange) LANG.onChange(paint);
    if (N) N.addEventListener('currententrychange', () => setTimeout(paint, 0));
    window.addEventListener('popstate', () => setTimeout(paint, 0));
    window.addEventListener('hashchange', () => setTimeout(paint, 0));
    ['navBack', 'navFwd'].forEach(id => { const o = document.getElementById(id); if (o) new MutationObserver(paint).observe(o, { attributes: true, attributeFilter: ['disabled'] }); });
    const nb = document.getElementById('navbar');
    if (nb) new MutationObserver(paint).observe(nb, { attributes: true, attributeFilter: ['hidden'] });
  }

  const T = (km, en) => (window.LANG ? LANG.t(km, en) : km);
  /** The ⚙️ button: the app's own language and dark buttons move into its menu, so they keep working as before. */
  function buildMenu(lang, sw) {
    const theme = document.getElementById('themeBtn');
    if (!theme || document.getElementById('setBtn') || lang.closest('#root')) return;   // Delivery (React) keeps its bar
    const st = document.createElement('style');
    st.textContent = '.set-wrap{flex:none;display:inline-flex}' +
      '.set-btn{flex:none;width:36px;height:36px;padding:0;margin:0;border-radius:50%;border:1px solid rgba(255,255,255,.3);background:rgba(255,255,255,.12);color:#fff;font-size:17px;line-height:1;display:grid;place-items:center;cursor:pointer}' +
      '.set-btn[aria-expanded="true"]{background:rgba(255,255,255,.28)}' +
      '.set-menu{position:fixed;z-index:1000;min-width:232px;padding:6px;display:grid;gap:2px;background:#fff;color:#011e41;border:1px solid #d6dee8;border-radius:14px;box-shadow:0 12px 30px rgba(1,30,65,.22);font:14px "Noto Sans Khmer",system-ui,sans-serif}' +
      '.set-menu[hidden]{display:none}.set-row{display:flex;align-items:center;gap:10px;padding:6px 8px;border-radius:10px;cursor:pointer}.set-row:hover{background:#eef3f9}' +
      '.set-menu .lang-btn,.set-menu #themeBtn{flex:none;margin:0;height:34px;min-width:34px;background:#eef3f9!important;border:1px solid #d6dee8!important;color:#011e41!important;border-radius:18px;box-shadow:none}' +
      '.set-menu .vm-sw{border-color:#cfd8e3;margin:0}.set-menu .vm-sw button{color:#011e41}.set-menu .vm-sw button.on{background:#dbe6f3}' +
      ':root[data-theme="dark"] .set-menu{background:#0d1e32;color:#e6eef7;border-color:#213852}:root[data-theme="dark"] .set-row:hover{background:#112d48}' +
      ':root[data-theme="dark"] .set-menu .lang-btn,:root[data-theme="dark"] .set-menu #themeBtn{background:#112d48!important;border-color:#213852!important;color:#e6eef7!important}' +
      ':root[data-theme="dark"] .set-menu .vm-sw button.on{background:#1d3d5e}' +
      '@media (prefers-color-scheme:dark){:root:not([data-theme="light"]) .set-menu{background:#0d1e32;color:#e6eef7;border-color:#213852}:root:not([data-theme="light"]) .set-row:hover{background:#112d48}' +
      ':root:not([data-theme="light"]) .set-menu .lang-btn,:root:not([data-theme="light"]) .set-menu #themeBtn{background:#112d48!important;border-color:#213852!important;color:#e6eef7!important}' +
      ':root:not([data-theme="light"]) .set-menu .vm-sw button.on{background:#1d3d5e}}';
    document.head.appendChild(st);
    const wrap = document.createElement('span');
    wrap.className = 'set-wrap';
    wrap.innerHTML = '<button type="button" class="set-btn" id="setBtn" aria-haspopup="true" aria-expanded="false"></button><div class="set-menu" id="setMenu" role="menu" hidden></div>';
    lang.parentNode.insertBefore(wrap, lang);
    const btn = wrap.firstChild, menu = wrap.lastChild;
    btn.textContent = '⚙️';
    const labels = [];
    const row = (ctrl, km, en) => {
      const r = document.createElement('div'), l = document.createElement('span');
      r.className = 'set-row'; l.className = 'set-lb'; l.dataset.km = km; l.dataset.en = en; labels.push(l);
      r.appendChild(ctrl); r.appendChild(l);
      // Tapping the words works like tapping the button next to them.
      r.onclick = e => { if ((e.target === l || e.target === r) && ctrl.tagName === 'BUTTON') ctrl.click(); };
      menu.appendChild(r);
    };
    row(lang, 'ភាសា', 'Language');
    row(sw, 'ទូរស័ព្ទ · កុំព្យូទ័រ', 'Phone · Computer');
    row(theme, 'ងងឹត · ភ្លឺ', 'Dark · Light');
    const paint = () => { labels.forEach(l => { l.textContent = T(l.dataset.km, l.dataset.en); }); btn.title = T('ការកំណត់', 'Settings'); btn.setAttribute('aria-label', btn.title); };
    paint();
    if (window.LANG && LANG.onChange) LANG.onChange(paint);
    const open = v => {
      if (v) {   // fixed under the button, so a rounded bar that clips its content can't hide the menu
        const b = btn.getBoundingClientRect();
        menu.style.top = Math.round(b.bottom + 8) + 'px';
        menu.style.right = Math.max(8, Math.round(document.documentElement.clientWidth - b.right)) + 'px';
      }
      menu.hidden = !v; btn.setAttribute('aria-expanded', String(!!v));
    };
    btn.onclick = e => { e.stopPropagation(); open(menu.hidden); };
    document.addEventListener('click', e => { if (!menu.hidden && !wrap.contains(e.target)) open(false); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') open(false); });
    window.addEventListener('resize', () => open(false));
    window.addEventListener('scroll', () => open(false), { passive: true });
  }
  /**
   * Delivery (React) keeps its own buttons, so they are not moved into a menu (React still owns them): a ⚙️ button
   * only shows or hides them under the bar, which leaves room for ‹ ›.
   */
  function reactGear() {
    const sw = document.getElementById('vmSw');
    const bar = sw && sw.parentNode;
    if (!bar || !sw.closest('#root')) return null;
    let g = document.getElementById('vmGear');
    if (g) return g;
    const st = document.createElement('style');
    st.textContent = '.vm-dd>*:not(.vm-nav):not(#vmGear){display:none!important}' +
      '.vm-dd.open>*:not(.vm-nav):not(#vmGear){display:inline-flex!important;position:fixed;right:22px;z-index:1001}' +
      '.vm-dd.open>.lang-btn{top:calc(70px + env(safe-area-inset-top));height:32px}.vm-dd.open>.vm-sw{top:calc(112px + env(safe-area-inset-top))}' +
      '.vm-dd.open>.vm-sw~*:not(.vm-nav):not(#vmGear){top:calc(158px + env(safe-area-inset-top));width:40px;height:32px}' +
      '.vm-dd.open::before{content:"";position:fixed;z-index:1000;top:calc(60px + env(safe-area-inset-top));right:10px;width:104px;height:142px;border-radius:14px;background:#091f3f;border:1px solid rgba(255,255,255,.2);box-shadow:0 12px 30px rgba(1,30,65,.35)}' +
      '#vmGear{flex:none;width:32px;height:32px;padding:0;margin:0;border-radius:50%;border:1px solid rgba(255,255,255,.3);background:rgba(255,255,255,.12);color:#fff;font-size:16px;line-height:1;display:grid;place-items:center;cursor:pointer}';
    document.head.appendChild(st);
    g = document.createElement('button');
    g.type = 'button'; g.id = 'vmGear'; g.textContent = '⚙️';
    g.title = T('ការកំណត់', 'Settings'); g.setAttribute('aria-label', g.title);
    bar.appendChild(g);
    bar.classList.add('vm-dd');
    g.onclick = e => { e.stopPropagation(); bar.classList.toggle('open'); };
    document.addEventListener('click', e => { if (bar.classList.contains('open') && !bar.contains(e.target)) bar.classList.remove('open'); });
    window.addEventListener('scroll', () => bar.classList.remove('open'), { passive: true });
    return g;
  }
  // Apps that draw their bar later (Delivery is React) get the switch as soon as the language button appears.
  function watch() {
    addButton();
    const mo = new MutationObserver(() => { if (!document.getElementById('vmSw')) addButton(); else if (!document.getElementById('vmNav')) addNav(); });
    mo.observe(document.body, { childList: true, subtree: true });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', watch); else watch();
  // 💬 Comment button for admins (Kim, 27 Nov 2026): feedback.js sits next to this file
  try { const me = JSON.parse(localStorage.getItem('steel_me') || 'null'); if (me && me.role === 'admin') {
    const s = document.createElement('script'); s.src = new URL('feedback.js?v=20261127a', document.currentScript ? document.currentScript.src : location.href).href; s.defer = true; document.head.appendChild(s); } } catch (e) { /* private window */ }
  window.addEventListener('load', () => { if (document.getElementById('vmSw')) unfreeze(); });
  window.VIEW_MODE = { get, pick };
})();
