/**
 * Column layout for every table (Kim, 12 Nov 2026: "do this for all tables in all apps … allow admin to drag and drop
 * or remove or add columns directly in the screen"). One shared file: add <script src="../table-cols.js"></script>.
 * - Admins drag a header onto another header to move the column, or press ⚙️ Columns above the table to hide, show
 *   and order columns. Everyone else sees the layout; only admins can change it.
 * - Admin = window.TC_ADMIN() when the app sets it, else Role "admin" from the iSteel home menu.
 * - Saved per table in this browser (localStorage), or through window.TC_STORE = { load(): obj, save(obj) } when an
 *   app keeps it on its server.
 * - Skipped: tables with data-nocols, tables under 3 columns, tables that already have their own column tool.
 */
(function () {
  if (window.__tableCols) return;
  window.__tableCols = true;

  const css = document.createElement('style');
  css.textContent = [
    '.tc-bar{display:flex;justify-content:flex-end;margin:4px 0}',
    '.tc-btn{font:inherit;font-size:13px;padding:3px 10px;border:1px solid rgba(127,127,127,.4);border-radius:8px;background:transparent;color:inherit;cursor:pointer}',
    '.tc-btn:hover{background:rgba(127,127,127,.12)}.tc-btn:disabled{opacity:.35;cursor:default}',
    'th.tc-drag{cursor:grab}th.tc-dragging{opacity:.45}th.tc-dropto,.tc-row.tc-dropto{box-shadow:inset 3px 0 0 #f39200}',
    '.tc-back{position:fixed;inset:0;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;z-index:99999}',
    '.tc-dlg{background:#fff;color:#1f2937;border-radius:14px;padding:16px;width:calc(100% - 32px);max-width:460px;max-height:86vh;display:flex;flex-direction:column;gap:8px;box-shadow:0 10px 40px rgba(0,0,0,.3);font-family:inherit}',
    '.tc-dlg h3{margin:0;font-size:17px}.tc-dlg p{margin:0;font-size:13px;color:#6b7280}',
    '.tc-list{overflow:auto;border:1px solid #e5e7eb;border-radius:10px}',
    '.tc-row{display:flex;align-items:center;gap:8px;padding:6px 10px;border-bottom:1px solid #e5e7eb;background:#fff}',
    '.tc-row[draggable="true"]{cursor:grab}.tc-row.tc-off{opacity:.6}.tc-row .tc-grip{width:14px;color:#9ca3af}',
    '.tc-row label{display:flex;align-items:center;gap:8px;margin:0;flex:1;font-size:14px}',
    '.tc-row .tc-btn{padding:2px 8px}.tc-btns{display:flex;gap:8px;align-items:center}.tc-btns .tc-sp{flex:1}',
    '.tc-ok{background:#f39200;border-color:#f39200;color:#fff}',
    '@media (prefers-color-scheme: dark){.tc-dlg,.tc-row{background:#1f2937;color:#f3f4f6}.tc-list,.tc-row{border-color:#374151}}'
  ].join('');
  document.head.appendChild(css);

  const kh = () => { try { return (localStorage.getItem('app_lang') || 'km') !== 'en'; } catch (e) { return true; } };
  const t = (k, e) => (kh() ? k : e);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const LS = 'tc_cols_' + location.pathname.replace(/[^a-z0-9]+/gi, '_');

  function homeAdmin() {
    try {
      const tok = (localStorage.getItem('fr_id_token') || '').split('.')[1];
      const em = tok ? JSON.parse(decodeURIComponent(escape(atob(tok.replace(/-/g, '+').replace(/_/g, '/'))))).email : '';
      const h = JSON.parse(localStorage.getItem('home_c_' + (em || 'demo')) || 'null');
      return !!(h && h.user && h.user.role === 'admin');
    } catch (e) { return false; }
  }
  const isAdmin = () => { try { return typeof window.TC_ADMIN === 'function' ? !!window.TC_ADMIN() : homeAdmin(); } catch (e) { return false; } };
  const load = () => {
    try { if (window.TC_STORE && window.TC_STORE.load) return window.TC_STORE.load() || {}; } catch (e) { /* fall back */ }
    try { return JSON.parse(localStorage.getItem(LS) || '{}') || {}; } catch (e) { return {}; }
  };
  function toast(msg) {
    const d = document.createElement('div');
    d.textContent = msg;
    d.style.cssText = 'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);background:#111827;color:#fff;padding:8px 14px;border-radius:10px;z-index:99999;font-size:14px';
    document.body.appendChild(d);
    setTimeout(() => d.remove(), 2600);
  }

  const headRow = tb => { const th = tb.querySelector('tr > th'); return th && th.parentElement.closest('table') === tb ? th.parentElement : null; };
  const rowsOf = tb => [...tb.querySelectorAll('tr')].filter(r => r.closest('table') === tb);
  const eligible = () => [...document.querySelectorAll('table')].filter(tb => tb.__tcKey || ok(tb));
  function ok(tb) {
    if (tb.hasAttribute('data-nocols') || tb.closest('.tc-dlg,[data-nocols]')) return false;
    const h = headRow(tb);
    if (!h || h.children.length < 3 || [...h.children].some(c => c.colSpan > 1)) return false;
    return !h.querySelector('th[draggable="true"]');   // already has its own column tool (Fuel Report, Scale)
  }
  const route = () => (location.hash.replace(/^#\/?/, '').split(/[/?]/)[0] || 'home');

  function apply(tb, lay) {
    const n = tb.__tcN;
    const order = Array.isArray(lay) && lay.length && lay.every(i => i >= 0 && i < n) ? lay : [...Array(n).keys()];
    rowsOf(tb).forEach(r => {
      if (r.children.length !== n || [...r.children].some(c => c.__tci == null)) return;
      const cells = [...r.children].sort((a, b) => a.__tci - b.__tci);
      const want = order.map(i => cells[i]).concat(cells.filter((c, i) => order.indexOf(i) < 0));
      cells.forEach((c, i) => { const hide = order.indexOf(i) < 0; if (c.hidden !== hide) c.hidden = hide; });
      if (want.some((c, i) => r.children[i] !== c)) { tb.__tcBusy = true; want.forEach(c => r.appendChild(c)); }
    });
    setTimeout(() => { tb.__tcBusy = false; }, 0);
  }
  const shown = tb => [...headRow(tb).children].filter(c => !c.hidden).map(c => c.__tci);
  async function save(key, lay) {
    const all = load();
    if (lay) all[key] = lay; else delete all[key];
    try { localStorage.setItem(LS, JSON.stringify(all)); } catch (e) { /* private window */ }
    eligible().forEach(tb => { if (tb.__tcKey === key) apply(tb, lay); });
    if (window.TC_STORE && window.TC_STORE.save) {
      try { await window.TC_STORE.save(all); toast(t('បានរក្សាទុកសម្រាប់អ្នកប្រើទាំងអស់', 'Saved for everyone')); }
      catch (e) { toast(t('រក្សាទុកតែលើកុំព្យូទ័រនេះ', 'Saved on this PC only') + ': ' + (e.message || e)); }
    } else toast(t('បានរក្សាទុកលើកុំព្យូទ័រនេះ', 'Saved on this PC'));
  }

  function index(tb) {
    const n = tb.__tcN;
    rowsOf(tb).forEach(r => { if (r.children.length === n && r.children[0].__tci == null) [...r.children].forEach((c, i) => { c.__tci = i; }); });
  }
  function kit(tb, i) {
    if (tb.__tcKey) {   // rows added later get the same layout
      if (!tb.__tcBusy && rowsOf(tb).some(r => r.children.length === tb.__tcN && r.children[0].__tci == null)) { index(tb); apply(tb, load()[tb.__tcKey]); }
      return;
    }
    const head = headRow(tb), n = tb.__tcN = head.children.length;
    const key = tb.__tcKey = route() + ':' + i + ':' + n;
    index(tb);
    const lay = load()[key];
    if (lay) apply(tb, lay);
    if (!isAdmin()) return;
    const name = j => (([...head.children].find(c => c.__tci === j) || {}).textContent || '').replace(/[▲▼]/g, '').trim();
    let from = -1;
    [...head.children].forEach(th => {
      th.draggable = true; th.classList.add('tc-drag');
      th.title = th.title || t('អូសដើម្បីរៀបចំជួរឈរ', 'Drag to move the column');
      th.addEventListener('dragstart', e => { from = th.__tci; try { e.dataTransfer.setData('text/plain', String(from)); } catch (er) { /* old browser */ } th.classList.add('tc-dragging'); });
      th.addEventListener('dragend', () => { th.classList.remove('tc-dragging'); head.querySelectorAll('.tc-dropto').forEach(x => x.classList.remove('tc-dropto')); });
      th.addEventListener('dragover', e => { if (from >= 0 && from !== th.__tci) { e.preventDefault(); th.classList.add('tc-dropto'); } });
      th.addEventListener('dragleave', () => th.classList.remove('tc-dropto'));
      th.addEventListener('drop', e => {
        e.preventDefault(); th.classList.remove('tc-dropto');
        const keys = shown(tb), a = keys.indexOf(from), b = keys.indexOf(th.__tci);
        from = -1;
        if (a < 0 || b < 0 || a === b) return;
        keys.splice(b, 0, keys.splice(a, 1)[0]);
        save(key, keys);
      });
    });
    // ⚙️ Columns sits above the table (above its scroll box when the table has one of its own)
    let box = tb;
    // never climb out of a grid or flex item: a new sibling there becomes its own cell and moves the table (Fuel SAP preview)
    const gf = el => { try { return /grid|flex/.test(getComputedStyle(el).display); } catch (e) { return false; } };
    while (box.parentElement && box.parentElement.children.length === 1 && box.parentElement !== document.body && box.parentElement.tagName !== 'TD' && !gf(box.parentElement.parentElement || document.body)) box = box.parentElement;
    if (box.previousElementSibling && box.previousElementSibling.classList.contains('tc-bar')) box.previousElementSibling.remove();
    if (box.parentElement && gf(box.parentElement)) {   // still in a grid/flex cell: put the bar inside the cell, above the table
      const cell = box === tb ? null : box;
      if (cell) { const old = cell.querySelector(':scope > .tc-bar'); if (old) old.remove(); }
      if (!cell) return;   // table is itself a grid item: leave the bar out, header drag still works
      box = cell.firstElementChild;
    }
    const bar = document.createElement('div');
    bar.className = 'tc-bar';
    bar.innerHTML = `<button type="button" class="tc-btn">⚙️ ${t('ជួរឈរ', 'Columns')}</button>`;
    bar.firstChild.onclick = () => {
      const def = [...Array(n).keys()];
      dialog(def.map(j => ({ k: j, h: name(j) || '#' + (j + 1) })), shown(tb), def, keys => save(key, keys.join(',') === def.join(',') ? null : keys));
    };
    box.parentNode.insertBefore(bar, box);
  }

  /** Tick to show, drag or ▲▼ to order. all = [{k, h}], keys = shown keys in order. */
  function dialog(all, keys, def, onSave) {
    keys = keys.slice();
    const back = document.createElement('div');
    back.className = 'tc-back';
    const hOf = k => (all.find(c => c.k === k) || {}).h || '';
    const draw = () => {
      const rest = all.filter(c => keys.indexOf(c.k) < 0);
      back.innerHTML = `<div class="tc-dlg" role="dialog" aria-modal="true"><h3>⚙️ ${t('ជួរឈរតារាង', 'Table columns')}</h3>
        <p>${t('ធីក = បង្ហាញ · អូស ឬ ▲▼ ដើម្បីប្តូរលំដាប់', 'Ticked = shown · drag or ▲▼ to change the order')}</p>
        <div class="tc-list">${keys.map((k, i) => `<div class="tc-row" draggable="true" data-i="${i}"><span class="tc-grip" aria-hidden="true">⠿</span><label><input type="checkbox" checked data-i="${i}"> ${esc(hOf(k))}</label><button type="button" class="tc-btn" data-up="${i}" ${i ? '' : 'disabled'}>▲</button><button type="button" class="tc-btn" data-dn="${i}" ${i < keys.length - 1 ? '' : 'disabled'}>▼</button></div>`).join('')}
        ${rest.map(c => `<div class="tc-row tc-off"><span class="tc-grip"></span><label><input type="checkbox" data-add="${all.indexOf(c)}"> ${esc(c.h)}</label></div>`).join('')}</div>
        <div class="tc-btns"><button type="button" class="tc-btn" data-act="reset">↺ ${t('លំនាំដើម', 'Default')}</button><span class="tc-sp"></span><button type="button" class="tc-btn" data-act="no">${t('បោះបង់', 'Cancel')}</button><button type="button" class="tc-btn tc-ok" data-act="ok">💾 ${t('រក្សាទុក', 'Save')}</button></div></div>`;
      back.querySelectorAll('input[data-i]').forEach(cb => { cb.onchange = () => { if (keys.length > 1) keys.splice(+cb.dataset.i, 1); draw(); }; });
      back.querySelectorAll('input[data-add]').forEach(cb => { cb.onchange = () => { keys.push(all[+cb.dataset.add].k); draw(); }; });
      back.querySelectorAll('[data-up]').forEach(b => { b.onclick = () => { const i = +b.dataset.up; keys.splice(i - 1, 0, keys.splice(i, 1)[0]); draw(); }; });
      back.querySelectorAll('[data-dn]').forEach(b => { b.onclick = () => { const i = +b.dataset.dn; keys.splice(i + 1, 0, keys.splice(i, 1)[0]); draw(); }; });
      let from = -1;
      back.querySelectorAll('.tc-row[draggable]').forEach(r => {
        r.addEventListener('dragstart', e => { from = +r.dataset.i; try { e.dataTransfer.setData('text/plain', String(from)); } catch (er) { /* old browser */ } });
        r.addEventListener('dragover', e => { if (from >= 0 && from !== +r.dataset.i) { e.preventDefault(); r.classList.add('tc-dropto'); } });
        r.addEventListener('dragleave', () => r.classList.remove('tc-dropto'));
        r.addEventListener('drop', e => { e.preventDefault(); if (from >= 0) { keys.splice(+r.dataset.i, 0, keys.splice(from, 1)[0]); from = -1; draw(); } });
      });
      back.querySelector('[data-act="reset"]').onclick = () => { keys = def.slice(); draw(); };
      back.querySelector('[data-act="no"]').onclick = () => back.remove();
      back.querySelector('[data-act="ok"]').onclick = () => { back.remove(); onSave(keys); };
    };
    draw();
    back.addEventListener('click', e => { if (e.target === back) back.remove(); });
    document.body.appendChild(back);
  }

  let q = 0;
  const run = () => {
    const byRoute = {};
    eligible().forEach(tb => { const r = route(); byRoute[r] = (byRoute[r] || 0); kit(tb, byRoute[r]++); });
  };
  const start = () => {
    run();
    new MutationObserver(() => { cancelAnimationFrame(q); q = requestAnimationFrame(run); }).observe(document.body, { childList: true, subtree: true });
  };
  if (document.body) start(); else document.addEventListener('DOMContentLoaded', start);
})();
