/**
 * Click any table header to sort that table (Kim, 8 Nov 2026: "always allow user to sort the table header in all tables
 * and in all apps"). One shared file for the plain-JS apps: add <script src="../table-sort.js"></script> to the page.
 * - Click once: A→Z / small→big (▲). Click again: Z→A / big→small (▼).
 * - Numbers ("17,430", "11,000 kg", "$8.16", "7 h 01") sort as numbers, dates (dd-mm-yyyy, yyyy-mm-dd) as dates, the rest as text.
 * - A table drawn again by the app (refresh, filter) keeps the last sort of a table with the same header names.
 * - Skipped: tables or headers with data-nosort, tables whose body rows use colspan (groups, totals), clicks on inputs.
 */
(function () {
  if (window.__tableSort) return;
  window.__tableSort = true;

  const css = document.createElement('style');
  css.textContent = 'table:not([data-nosort]) tr > th:not([data-nosort]){cursor:pointer;user-select:none}' +
    'th[data-sort="asc"]::after{content:" \\25B2";font-size:.75em;opacity:.7}' +
    'th[data-sort="desc"]::after{content:" \\25BC";font-size:.75em;opacity:.7}';
  document.head.appendChild(css);

  const MEMO = {};   // header names joined → [column, 'asc' | 'desc']
  const headRow = table => { const th = table.querySelector('tr > th'); return th ? th.parentElement : null; };
  const sig = tr => Array.from(tr.children).map(c => c.textContent.trim()).join('|');
  const bodyRows = (table, head) => Array.from(table.querySelectorAll('tr')).filter(r => r !== head && r.closest('table') === table && r.querySelector('td'));

  function key(text) {
    const s = String(text || '').trim();
    if (!s || s === '—' || s === '-') return null;
    // A time after the date ("12/11/2026 08:09:39") sorts inside the day too.
    const tm = x => { const t = s.slice(x.length).match(/^[ T]+(\d{1,2}):(\d{2})(?::(\d{2}))?/); return t ? +t[1] * 3600 + +t[2] * 60 + +(t[3] || 0) : 0; };
    let m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/);
    if (m) return { n: +(m[3] + ('0' + m[2]).slice(-2) + ('0' + m[1]).slice(-2)) * 1e5 + tm(m[0]) };
    m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return { n: +(m[1] + m[2] + m[3]) * 1e5 + tm(m[0]) };
    m = s.match(/^(\d+)\s*h\s*(\d+)/i);
    if (m) return { n: +m[1] * 60 + +m[2] };
    const num = s.replace(/[,\s$%៛]/g, '').replace(/(kg|t|min|km|l)$/i, '');
    if (/^[-+]?\d*\.?\d+$/.test(num)) return { n: parseFloat(num) };
    return { s: s.toLowerCase() };
  }

  function sortTable(table, col, dir) {
    const head = headRow(table);
    if (!head) return false;
    const rows = bodyRows(table, head);
    if (rows.length < 2 || rows.some(r => Array.from(r.children).some(c => c.colSpan > 1))) return false;
    const k = rows.map((r, i) => ({ r, i, v: key(r.children[col] ? r.children[col].textContent : '') }));
    const allNum = k.every(x => !x.v || 'n' in x.v);
    k.sort((a, b) => {
      if (!a.v && !b.v) return a.i - b.i;
      if (!a.v) return 1;
      if (!b.v) return -1;   // empty cells always last
      let d = allNum ? a.v.n - b.v.n : String(a.v.s != null ? a.v.s : a.v.n).localeCompare(String(b.v.s != null ? b.v.s : b.v.n), undefined, { numeric: true });
      if (dir === 'desc') d = -d;
      return d || a.i - b.i;
    });
    const parent = rows[0].parentNode;
    table.__sorting = true;
    k.forEach(x => parent.appendChild(x.r));
    Array.from(head.children).forEach((c, i) => { if (i === col) c.setAttribute('data-sort', dir); else c.removeAttribute('data-sort'); });
    table.__sorted = sig(head) + '#' + col + dir;
    setTimeout(() => { table.__sorting = false; }, 0);
    return true;
  }

  document.addEventListener('click', e => {
    const th = e.target.closest && e.target.closest('th');
    if (!th || th.hasAttribute('data-nosort') || e.target.closest('input,button,a,select,label')) return;
    const table = th.closest('table');
    if (!table || table.hasAttribute('data-nosort') || headRow(table) !== th.parentElement) return;
    const col = Array.from(th.parentElement.children).indexOf(th);
    const dir = th.getAttribute('data-sort') === 'asc' ? 'desc' : 'asc';
    if (sortTable(table, col, dir)) MEMO[sig(th.parentElement)] = [col, dir];
  }, true);

  // A table the app draws again gets the same sort back.
  let q = 0;
  new MutationObserver(() => {
    clearTimeout(q);
    q = setTimeout(() => {
      document.querySelectorAll('table:not([data-nosort])').forEach(table => {
        if (table.__sorting) return;
        const head = headRow(table);
        if (!head) return;
        const m = MEMO[sig(head)];
        if (m && table.__sorted !== sig(head) + '#' + m[0] + m[1]) sortTable(table, m[0], m[1]);
      });
    }, 30);
  }).observe(document.documentElement, { childList: true, subtree: true });
})();
