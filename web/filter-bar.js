/**
 * "Option D" filter header for every app (Kim, 12–13 Nov 2026), same look as the Truck Scale Report.
 * Add <link rel="stylesheet" href="../filter-bar.css"> and <script src="../filter-bar.js"></script>, then build with:
 *   FB.head(key, title, actionsHtml, onClear)  title line: ✕ Clear all · actions · Filter toggle
 *   FB.panel(key, innerHtml)                    the light-blue panel (open/closed is remembered per key)
 *   FB.range(idFrom, idTo, from, to), FB.show(id), FB.search(id, placeholder, value), FB.field(label, html),
 *   FB.seg(items[[key, label]], active, attr)   segmented quick buttons (data-<attr>="key")
 *   FB.xl                                       the green Excel mark
 * Wrap both in <div class="fb-wrap">…</div>.
 */
(function () {
  if (window.FB) return;
  const t = (k, e) => (window.LANG ? LANG.t(k, e) : k);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const get = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const put = (k, v) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { /* private window */ } };
  const KEY = k => 'fb_open_' + location.pathname.replace(/[^a-z0-9]+/gi, '_') + k;
  const open = k => get(KEY(k)) !== '0';
  const CLEAR = {};
  const FB = {
    esc,
    xl: '<span class="fb-xl" aria-hidden="true">X</span>',
    open,
    head(k, title, acts, onClear) {
      if (onClear) CLEAR[k] = onClear;
      return `<div class="fb-head"><h2>${title}</h2><div class="fb-acts">${onClear ? `<button type="button" class="fb-btn" data-fbclr="${k}">✕ ${t('សម្អាតទាំងអស់', 'Clear all')}</button>` : ''}${acts || ''}` +
        `<button type="button" class="fb-btn fb-tog${open(k) ? ' on' : ''}" data-fbtog="${k}" aria-expanded="${open(k)}">⏷ ${t('តម្រង', 'Filter')} <span class="fb-car">${open(k) ? '▴' : '▾'}</span></button></div></div>`;
    },
    panel: (k, inner) => `<div class="fb-panel" data-fbp="${k}"${open(k) ? '' : ' hidden'}>${inner}</div>`,
    field: (label, html, cls) => `<label class="fb-field${cls ? ' ' + cls : ''}">${label}${html}</label>`,
    range: (a, b, va, vb) => `<label class="fb-field fb-range">📅 ${t('ចន្លោះថ្ងៃ', 'Date range')}<span><input type="date" id="${a}" value="${esc(va)}"><i>–</i><input type="date" id="${b}" value="${esc(vb)}"></span></label>`,
    show: id => `<button type="button" class="fb-show" id="${id}">🔍 ${t('បង្ហាញ', 'Show')}</button>`,
    search: (id, ph, v) => `<label class="fb-search"><span class="fb-ico" aria-hidden="true">🔍</span><input type="search" id="${id}" data-live-ok placeholder="${esc(ph)}" value="${esc(v)}" aria-label="${t('ស្វែងរក', 'Search')}"></label>`,
    seg: (items, on, attr, wrap) => `<div class="fb-seg${wrap ? ' wrap' : ''}">${items.map(i => `<button type="button" class="${i[0] === on ? 'on' : ''}" data-${attr}="${esc(i[0])}">${i[1]}</button>`).join('')}</div>`
  };
  document.addEventListener('click', e => {
    const c = e.target.closest && e.target.closest('[data-fbclr]');
    if (c && CLEAR[c.dataset.fbclr]) { CLEAR[c.dataset.fbclr](); return; }
    const b = e.target.closest && e.target.closest('[data-fbtog]');
    if (!b) return;
    const k = b.dataset.fbtog, p = document.querySelector(`[data-fbp="${k}"]`), now = p ? p.hidden : !open(k);
    if (p) p.hidden = !now;
    put(KEY(k), now ? null : '0');
    b.classList.toggle('on', now); b.setAttribute('aria-expanded', now);
    const car = b.querySelector('.fb-car'); if (car) car.textContent = now ? '▴' : '▾';
  });
  window.FB = FB;
})();
