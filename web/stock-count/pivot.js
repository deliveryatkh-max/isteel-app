/**
 * Drag-and-drop pivot table, like an Excel PivotTable (Kim, 20 Nov 2026: "user can drag and drop by their own same
 * as pivot table work in excel"). Used by the Stock list and Movements screens.
 * - Field chips are dragged into Filters, Columns, Rows or Values (computer), or tapped then a box tapped (phone).
 * - Values: Sum / Count / Average / Min / Max. Filters: tick the values to keep. Grand totals and Rows subtotals.
 * - The layout is kept in this browser per screen; ⬇ Excel downloads the pivot as shown.
 * window.SCPivot.mount(el, { id, data, fields: [{ k, km, en, num }], def: { rows, cols, vals: [{ k, agg }], filters }, T, onExport })
 */
(function () {
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = n => (n == null || n === '' || !isFinite(n) ? '' : Number(Math.round(n * 1000) / 1000).toLocaleString('en-US', { maximumFractionDigits: 3 }));
  const AGG = { sum: ['សរុប', 'Sum'], count: ['ចំនួនជួរ', 'Count'], avg: ['មធ្យម', 'Average'], min: ['តូចបំផុត', 'Min'], max: ['ធំបំផុត', 'Max'] };
  const load = id => { try { return JSON.parse(localStorage.getItem('scpv_' + id) || 'null'); } catch (e) { return null; } };
  const save = (id, st) => { try { localStorage.setItem('scpv_' + id, JSON.stringify(st)); } catch (e) { /* private mode */ } };
  const clone = o => JSON.parse(JSON.stringify(o));

  function mount(el, cfg) {
    const T = cfg.T || ((km, en) => en);
    const F = {}; cfg.fields.forEach(f => { F[f.k] = f; });
    const label = k => (F[k] ? T(F[k].km, F[k].en) : k);
    let st = load(cfg.id) || clone(cfg.def);
    st.rows = (st.rows || []).filter(k => F[k]); st.cols = (st.cols || []).filter(k => F[k]);
    st.vals = (st.vals || []).filter(v => F[v.k]); st.filters = st.filters || {};
    Object.keys(st.filters).forEach(k => { if (!F[k]) delete st.filters[k]; });
    let picked = null, openFilter = null;
    const used = () => new Set(st.rows.concat(st.cols, Object.keys(st.filters)));

    function compute() {
      const data = cfg.data.filter(r => Object.keys(st.filters).every(k => { const keep = st.filters[k]; return !keep || !keep.length || keep.indexOf(String(r[k] == null ? '' : r[k])) >= 0; }));
      const key = (r, ks) => ks.map(k => String(r[k] == null ? '' : r[k]));
      const sortKeys = list => list.sort((a, b) => { for (let i = 0; i < a.length; i++) { const c = a[i].localeCompare(b[i], undefined, { numeric: true }); if (c) return c; } return 0; });
      const uniq = ks => { const m = {}; data.forEach(r => { const kk = key(r, ks); m[JSON.stringify(kk)] = kk; }); return sortKeys(Object.values(m)); };
      const rowKeys = st.rows.length ? uniq(st.rows) : [[]], colKeys = st.cols.length ? uniq(st.cols) : [[]];
      const cells = {};
      const acc = (rk, ck, r) => {
        const id = rk + '\u0001' + ck;
        // Same rules as Excel: Count = non-blank cells, Sum / Average / Min / Max use the number cells only.
        const c = cells[id] || (cells[id] = st.vals.map(() => ({ n: 0, nn: 0, s: 0, min: Infinity, max: -Infinity })));
        st.vals.forEach((v, i) => { const raw = r[v.k], a = c[i]; if (raw === '' || raw == null) return; a.n++; const x = Number(raw);
          if (typeof raw === 'number' || (isFinite(x) && F[v.k].num)) { a.nn++; a.s += x; if (x < a.min) a.min = x; if (x > a.max) a.max = x; } });
      };
      data.forEach(r => {
        const rk = key(r, st.rows), ck = key(r, st.cols);
        const rks = ['*'].concat(st.rows.length > 1 ? [JSON.stringify(rk.slice(0, 1)) + '#sub'] : [], [JSON.stringify(rk)]);
        const cks = ['*', JSON.stringify(ck)];
        rks.forEach(a => cks.forEach(b => acc(a, b, r)));
      });
      const val = (rk, ck, i) => { const c = cells[rk + '\u0001' + ck]; if (!c) return null; const a = c[i], g = st.vals[i].agg;
        return g === 'count' ? a.n : g === 'avg' ? (a.nn ? a.s / a.nn : null) : g === 'min' ? (a.min === Infinity ? null : a.min) : g === 'max' ? (a.max === -Infinity ? null : a.max) : a.s; };
      return { data: data, rowKeys: rowKeys, colKeys: colKeys, val: val };
    }

    function table(p) {
      const nv = st.vals.length;
      if (!nv) return `<p class="muted pv-hint">${T('អូសវាលមួយទៅ «តម្លៃ» ដើម្បីមើលលេខ។', 'Drag a field into Values to see numbers.')}</p>`;
      const colSpan = Math.max(1, nv);
      const vName = v => `${T(AGG[v.agg][0], AGG[v.agg][1])} ${label(v.k)}`;
      const showCols = st.cols.length ? p.colKeys : [];
      let h = '<table class="pv-t" data-nocols data-nosort><thead>';
      // header rows: one per column field, then the value names
      st.cols.forEach((c, li) => {
        h += `<tr>${li === 0 ? `<th class="pv-corner" rowspan="${st.cols.length + (nv > 1 ? 1 : 0)}" colspan="${Math.max(1, st.rows.length)}">${st.rows.map(label).map(esc).join(' / ') || ''}</th>` : ''}`;
        let prev = null;
        showCols.forEach((ck, i) => {
          const same = prev && ck.slice(0, li + 1).join('\u0001') === prev;
          if (!same) { let span = 0; for (let j = i; j < showCols.length && showCols[j].slice(0, li + 1).join('\u0001') === ck.slice(0, li + 1).join('\u0001'); j++) span++; h += `<th colspan="${span * colSpan}">${esc(ck[li] || '(blank)')}</th>`; }
          prev = ck.slice(0, li + 1).join('\u0001');
        });
        h += li === 0 ? `<th class="pv-tot" rowspan="${st.cols.length - li}" colspan="${colSpan}">${T('សរុបរួម', 'Grand total')}</th>` : '';
        h += '</tr>';
      });
      if (nv > 1 || !st.cols.length) {
        h += `<tr>${!st.cols.length ? `<th class="pv-corner" colspan="${Math.max(1, st.rows.length)}">${st.rows.map(label).map(esc).join(' / ')}</th>` : ''}`;
        (showCols.length ? showCols : []).forEach(() => st.vals.forEach(v => { h += `<th>${esc(vName(v))}</th>`; }));
        st.vals.forEach(v => { h += `<th class="pv-tot">${esc(vName(v))}</th>`; });
        h += '</tr>';
      } else if (nv === 1 && st.cols.length) {
        h = h.replace('<th class="pv-corner"', `<th class="pv-corner" title="${esc(vName(st.vals[0]))}"`);
      }
      h += '</thead><tbody>';
      const line = (rk, labels, cls) => {
        let r = `<tr class="${cls || ''}">`;
        labels.forEach(l => { r += `<td class="pv-rl">${l}</td>`; });
        showCols.forEach(ck => st.vals.forEach((v, i) => { const x = p.val(rk, JSON.stringify(ck), i); r += `<td class="num">${fmt(x)}</td>`; }));
        st.vals.forEach((v, i) => { r += `<td class="num pv-tot">${fmt(p.val(rk, '*', i))}</td>`; });
        return r + '</tr>';
      };
      if (st.rows.length) {
        let prevTop = null;
        p.rowKeys.forEach((rk, idx) => {
          if (st.rows.length > 1 && rk[0] !== prevTop) {
            if (prevTop !== null) h += line(JSON.stringify([prevTop]) + '#sub', [`<b>${esc(prevTop || '(blank)')} ${T('សរុប', 'total')}</b>`].concat(st.rows.slice(1).map(() => '')), 'pv-sub');
            prevTop = rk[0];
          }
          const prev = p.rowKeys[idx - 1];
          const labels = rk.map((v, li) => (prev && prev.slice(0, li + 1).join('\u0001') === rk.slice(0, li + 1).join('\u0001') ? '' : esc(v || '(blank)')));
          h += line(JSON.stringify(rk), labels);
        });
        if (st.rows.length > 1 && prevTop !== null) h += line(JSON.stringify([prevTop]) + '#sub', [`<b>${esc(prevTop || '(blank)')} ${T('សរុប', 'total')}</b>`].concat(st.rows.slice(1).map(() => '')), 'pv-sub');
      }
      h += line('*', [`<b>${T('សរុបរួម', 'Grand total')}</b>`].concat(st.rows.slice(1).map(() => '')), 'pv-grand');
      return h + '</tbody></table>';
    }

    function chip(k, zone, i) {
      const f = F[k];
      if (zone === 'vals') {
        const v = st.vals[i];
        return `<span class="pv-chip v" draggable="true" data-k="${esc(k)}" data-from="vals" data-i="${i}"><select data-agg="${i}">${Object.keys(AGG).map(a => `<option value="${a}"${a === v.agg ? ' selected' : ''}>${T(AGG[a][0], AGG[a][1])}</option>`).join('')}</select> ${esc(label(k))}<button type="button" class="pv-x" data-rm="vals" data-i="${i}" aria-label="remove">✕</button></span>`;
      }
      const nf = zone === 'filters' && st.filters[k] && st.filters[k].length;
      return `<span class="pv-chip${picked && picked.k === k && picked.from === zone ? ' on' : ''}${f.num ? ' n' : ''}" draggable="true" data-k="${esc(k)}" data-from="${zone}">${zone === 'filters' ? `<button type="button" class="pv-f" data-flt="${esc(k)}">▾</button>` : ''}${esc(label(k))}${nf ? ` <small>(${nf})</small>` : ''}${zone !== 'list' ? `<button type="button" class="pv-x" data-rm="${zone}" data-k="${esc(k)}" aria-label="remove">✕</button>` : ''}</span>`;
    }
    function filterBox(k) {
      const all = Array.from(new Set(cfg.data.map(r => String(r[k] == null ? '' : r[k])))).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
      const keep = st.filters[k] || [];
      return `<div class="pv-fbox"><div class="pv-fh"><b>${esc(label(k))}</b><button type="button" class="pv-x" data-fclose="1">✕</button></div>
        <div class="pv-fa"><button type="button" class="btn ghost sm" data-fall="1">${T('ទាំងអស់', 'All')}</button><button type="button" class="btn ghost sm" data-fnone="1">${T('គ្មាន', 'None')}</button></div>
        <div class="pv-fl">${all.map(v => `<label><input type="checkbox" data-fv="${esc(v)}"${!keep.length || keep.indexOf(v) >= 0 ? ' checked' : ''}> ${esc(v || '(blank)')}</label>`).join('')}</div></div>`;
    }

    function draw() {
      save(cfg.id, st);
      const p = compute(), u = used();
      const zone = (z, km, en, keys) => `<div class="pv-zone" data-zone="${z}"><div class="pv-zh">${T(km, en)}</div><div class="pv-zc">${keys.map((k, i) => chip(k, z, i)).join('') || `<span class="pv-empty">${T('អូសមកទីនេះ', 'Drop here')}</span>`}</div></div>`;
      el.innerHTML = `<div class="pv">
        <div class="pv-side">
          <div class="pv-zone pv-list" data-zone="list"><div class="pv-zh">${T('វាល (អូស ឬចុច)', 'Fields (drag or tap)')}</div><div class="pv-zc">${cfg.fields.filter(f => !u.has(f.k)).map(f => chip(f.k, 'list')).join('')}</div></div>
          ${zone('filters', 'តម្រង', 'Filters', Object.keys(st.filters))}
          ${zone('cols', 'ជួរឈរ', 'Columns', st.cols)}
          ${zone('rows', 'ជួរដេក', 'Rows', st.rows)}
          ${zone('vals', 'តម្លៃ', 'Values', st.vals.map(v => v.k))}
          <div class="pv-tools"><button type="button" class="btn ghost sm" data-reset="1">↺ ${T('ដើមវិញ', 'Reset')}</button><button type="button" class="btn ghost sm" data-xls="1">⬇ Excel</button><small class="muted">${p.data.length} ${T('ជួរ', 'rows')}</small></div>
          ${openFilter ? filterBox(openFilter) : ''}
        </div>
        <div class="pv-out">${table(p)}</div></div>`;
      wire(p);
    }

    function move(k, from, to, at) {
      if (from === to && to !== 'vals') return;
      if (from === 'rows') st.rows = st.rows.filter(x => x !== k);
      if (from === 'cols') st.cols = st.cols.filter(x => x !== k);
      if (from === 'filters' && to !== 'filters') delete st.filters[k];
      if (to === 'rows' && st.rows.indexOf(k) < 0) st.rows.splice(at == null ? st.rows.length : at, 0, k);
      if (to === 'cols' && st.cols.indexOf(k) < 0) st.cols.splice(at == null ? st.cols.length : at, 0, k);
      if (to === 'filters' && !st.filters[k]) st.filters[k] = [];
      if (to === 'vals' && from !== 'vals') st.vals.push({ k: k, agg: F[k].num ? 'sum' : 'count' });
      picked = null; draw();
    }

    function wire(p) {
      el.querySelectorAll('.pv-chip').forEach(c => {
        c.addEventListener('dragstart', e => { e.dataTransfer.setData('text/plain', JSON.stringify({ k: c.dataset.k, from: c.dataset.from, i: c.dataset.i })); c.classList.add('drag'); });
        c.addEventListener('dragend', () => c.classList.remove('drag'));
        c.addEventListener('click', e => {
          if (e.target.closest('select, button')) return;
          picked = picked && picked.k === c.dataset.k && picked.from === c.dataset.from ? null : { k: c.dataset.k, from: c.dataset.from, i: c.dataset.i };
          el.querySelectorAll('.pv-chip').forEach(x => x.classList.toggle('on', !!picked && x === c));
          el.querySelectorAll('.pv-zone').forEach(z => z.classList.toggle('target', !!picked));
        });
      });
      el.querySelectorAll('.pv-zone').forEach(z => {
        z.addEventListener('dragover', e => { e.preventDefault(); z.classList.add('over'); });
        z.addEventListener('dragleave', () => z.classList.remove('over'));
        z.addEventListener('drop', e => {
          e.preventDefault(); z.classList.remove('over');
          let d; try { d = JSON.parse(e.dataTransfer.getData('text/plain')); } catch (er) { return; }
          const to = z.dataset.zone, tgt = e.target.closest('.pv-chip');
          const at = tgt && tgt.dataset.from === to && (to === 'rows' || to === 'cols') ? (to === 'rows' ? st.rows : st.cols).indexOf(tgt.dataset.k) : null;
          if (to === 'list') { removeFrom(d.from, d.k, d.i); return; }
          if (d.from === to && (to === 'rows' || to === 'cols') && at != null) { const arr = to === 'rows' ? st.rows : st.cols; arr.splice(arr.indexOf(d.k), 1); arr.splice(at, 0, d.k); draw(); return; }
          move(d.k, d.from, to, at);
        });
        z.querySelector('.pv-zh').addEventListener('click', () => { if (!picked) return; if (z.dataset.zone === 'list') removeFrom(picked.from, picked.k, picked.i); else move(picked.k, picked.from, z.dataset.zone); });
        z.querySelector('.pv-zc').addEventListener('click', e => { if (!picked || e.target.closest('.pv-chip')) return; if (z.dataset.zone === 'list') removeFrom(picked.from, picked.k, picked.i); else move(picked.k, picked.from, z.dataset.zone); });
      });
      el.querySelectorAll('[data-rm]').forEach(b => { b.onclick = () => removeFrom(b.dataset.rm, b.dataset.k, b.dataset.i); });
      el.querySelectorAll('[data-agg]').forEach(s => { s.onchange = () => { st.vals[Number(s.dataset.agg)].agg = s.value; draw(); }; });
      el.querySelectorAll('[data-flt]').forEach(b => { b.onclick = () => { openFilter = openFilter === b.dataset.flt ? null : b.dataset.flt; draw(); }; });
      const fb = el.querySelector('.pv-fbox');
      if (fb) {
        const all = () => Array.from(fb.querySelectorAll('[data-fv]'));
        const apply = () => { const on = all().filter(x => x.checked).map(x => x.dataset.fv); st.filters[openFilter] = on.length === all().length ? [] : (on.length ? on : ['\u0000none']); draw(); };
        all().forEach(x => { x.onchange = apply; });
        fb.querySelector('[data-fall]').onclick = () => { all().forEach(x => { x.checked = true; }); apply(); };
        fb.querySelector('[data-fnone]').onclick = () => { all().forEach(x => { x.checked = false; }); apply(); };
        fb.querySelector('[data-fclose]').onclick = () => { openFilter = null; draw(); };
      }
      el.querySelector('[data-reset]').onclick = () => { st = clone(cfg.def); openFilter = null; picked = null; draw(); };
      el.querySelector('[data-xls]').onclick = () => exportCsv();
    }
    function removeFrom(zone, k, i) {
      if (zone === 'rows') st.rows = st.rows.filter(x => x !== k);
      else if (zone === 'cols') st.cols = st.cols.filter(x => x !== k);
      else if (zone === 'filters') { delete st.filters[k]; if (openFilter === k) openFilter = null; }
      else if (zone === 'vals') st.vals.splice(Number(i), 1);
      picked = null; draw();
    }
    function exportCsv() {
      const t = el.querySelector('.pv-t'); if (!t) return;
      const grid = [];
      Array.from(t.rows).forEach((tr, ri) => {
        grid[ri] = grid[ri] || [];
        let ci = 0;
        Array.from(tr.cells).forEach(td => {
          while (grid[ri][ci] !== undefined) ci++;
          const cs = td.colSpan || 1, rs = td.rowSpan || 1;
          for (let a = 0; a < rs; a++) for (let b = 0; b < cs; b++) { grid[ri + a] = grid[ri + a] || []; grid[ri + a][ci + b] = a === 0 && b === 0 ? td.textContent.trim() : ''; }
          ci += cs;
        });
      });
      if (cfg.onExport) cfg.onExport(grid);
    }
    draw();
  }
  window.SCPivot = { mount: mount };
})();
