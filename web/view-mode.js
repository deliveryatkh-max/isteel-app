/**
 * 📱 / 🖥️ switch next to the language button (Kim, 13 Nov 2026), in every app.
 * Phone look on a computer: the app opens in a phone-sized frame in the middle of the screen.
 * Computer look on a phone: the page is drawn 1280px wide (pinch to zoom).
 * The choice is remembered on this device (localStorage isteel_view); picking the device's own look clears it.
 * Load it in <head> (it must run before the page body): <script src="../view-mode.js"></script>
 */
(function () {
  const KEY = 'isteel_view';
  const get = () => { try { return localStorage.getItem(KEY) || ''; } catch (e) { return ''; } };
  const put = v => { try { if (v) localStorage.setItem(KEY, v); else localStorage.removeItem(KEY); } catch (e) { /* private window */ } };
  const mode = get();
  // Phone header (Kim, 13 Nov 2026, option C): inside an app, phones show the ISI circle without the word STEEL.
  try {
    const hs = document.createElement('style');
    hs.textContent = '@media (max-width:600px){.isi-logo:has(+ .sep) .word{display:none}}';
    document.head.appendChild(hs);
  } catch (e) { /* no head yet */ }
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
