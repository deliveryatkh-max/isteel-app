/**
 * 📱 / 🖥️ switch next to the language button (Kim, 13 Nov 2026), in every app.
 * Phone look on a computer: the app opens in a phone-sized frame in the middle of the screen.
 * Computer look on a phone: the page is drawn 1280px wide (pinch to zoom).
 * The choice is remembered on this device (localStorage isteel_view); picking the device's own look clears it.
 * Load it in <head> (it must run before the page body): <script src="../view-mode.js"></script>
 * Header (Kim, 13 Nov 2026, option B): one ⚙️ button in the bar; language, phone/computer and dark mode sit in its menu.
 */
(function () {
  const KEY = 'isteel_view';
  const get = () => { try { return localStorage.getItem(KEY) || ''; } catch (e) { return ''; } };
  const put = v => { try { if (v) localStorage.setItem(KEY, v); else localStorage.removeItem(KEY); } catch (e) { /* private window */ } };
  const mode = get();
  const inFrame = window !== window.top && /[?&]vm=in\b/.test(location.search);
  const phoneDevice = Math.min(screen.width, screen.height) < 700 && matchMedia('(pointer: coarse)').matches;

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

  const looksPhone = () => inFrame || (mode !== 'desktop' && (phoneDevice || mode === 'mobile'));
  function pick(v) {
    const natural = phoneDevice ? 'mobile' : 'desktop';
    put(v === natural ? '' : v);
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
  // Apps that draw their bar later (Delivery is React) get the switch as soon as the language button appears.
  function watch() {
    addButton();
    const mo = new MutationObserver(() => { if (!document.getElementById('vmSw')) addButton(); });
    mo.observe(document.body, { childList: true, subtree: true });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', watch); else watch();
  window.VIEW_MODE = { get, pick };
})();
