/**
 * Gate vs Scale matching (Kim, 14 Nov 2026): "Weight ticket and Inbound record the plate number of a truck in on the same
 * day. I want to cross check both records to ensure the 2 teams' records match."
 * Pure functions (no screen), shared by gs.js and the node test (test-core.js).
 *
 * Inbound receipt  { id, truck, date 'yyyy-MM-dd', start 'HH:mm', end, site, warehouse, carrier, owner, status, items[] }
 * Scale ticket     { no, plate, type 'In'|'Out'|'', status, t1 'yyyy-MM-ddTHH:mm:ss', t2, w1, w2, net, company }
 * Only Scale tickets that unloaded here (type In) and are not cancelled are compared.
 *
 * Passes, each on what is left over from the pass before:
 *  1 ok    same plate, same day
 *  2 day   same plate, the day before or after and at most 24 h from the truck's time on site (1st weigh one day, unloaded and 2nd weigh the next)
 *  3 typo  same day (or ±1 day), plate differs by one letter or digit, or one character more or less
 * What is still left = Inbound only / Scale only.
 */
(function (root) {
  'use strict';
  const norm = s => String(s == null ? '' : s).toUpperCase().replace(/[\s\-._/]/g, '');
  const dirOf = (w1, w2) => (w1 === '' || w1 == null || w2 === '' || w2 == null ? '' : Number(w1) > Number(w2) ? 'In' : 'Out');
  const typeOf = x => (x.type === 'In' || x.type === 'Out' ? x.type : dirOf(x.w1, x.w2));
  const dayOf = v => String(v || '').slice(0, 10);
  const hmOf = v => { const m = String(v || '').match(/[T ](\d{2}:\d{2})/); return m ? m[1] : ''; };
  const addDays = (d, n) => { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
  const dayDiff = (a, b) => Math.round((Date.parse(a + 'T00:00:00Z') - Date.parse(b + 'T00:00:00Z')) / 86400000);
  const DAY_GAP = 24 * 60;   // a match on the next/previous day must be at most 24 hours apart
  const mins = (d, hm) => (d && hm ? Date.parse(d + 'T' + hm + ':00Z') / 60000 : NaN);

  /** One edit apart: one character changed, or one more / one less. 0 = same, 1 = one edit, 9 = further. */
  function edits(a, b) {
    if (a === b) return 0;
    if (Math.abs(a.length - b.length) > 1 || !a || !b) return 9;
    if (a.length === b.length) { let d = 0; for (let i = 0; i < a.length; i++) if (a[i] !== b[i] && ++d > 1) return 9; return 1; }
    const [s, l] = a.length < b.length ? [a, b] : [b, a];
    for (let i = 0; i < l.length; i++) if (l.slice(0, i) + l.slice(i + 1) === s) return 1;
    return 9;
  }
  /** Inbound kg on the truck: GR qty, or the arrival qty while unloading. */
  function ibKg(r) {
    let s = 0, any = false;
    (r.items || []).forEach(i => { const v = Number(i.grQty !== '' && i.grQty != null ? i.grQty : i.arrQty); if (isFinite(v) && v) { s += v; any = true; } });
    return any && /^kg$/i.test(r.uom || 'Kg') ? Math.round(s) : '';
  }

  /**
   * receipts, tickets: as loaded (any dates). from/to: 'yyyy-MM-dd'. Returns rows for the days from..to:
   * { st: 'ok'|'day'|'typo'|'ib'|'sc', date, ib, sc, note }
   */
  function match(receipts, tickets, from, to) {
    const lo = addDays(from, -1), hi = addDays(to, 1);
    const IB = (receipts || []).filter(r => r && r.truck && r.date >= lo && r.date <= hi)
      .map(r => ({ r, p: norm(r.truck), d: r.date, m: mins(r.date, r.start), used: false }));
    const allSc = (tickets || []).filter(x => x && x.plate && x.status !== 'Void');
    const SC = allSc.filter(x => typeOf(x) === 'In').map(x => ({ x, p: norm(x.plate), d: dayOf(x.t1 || x.created), m: mins(dayOf(x.t1), hmOf(x.t1)), m2: mins(dayOf(x.t2), hmOf(x.t2)), used: false }))
      .filter(s => s.d >= lo && s.d <= hi);
    const rows = [];
    const pair = (a, b, st) => { a.used = b.used = true; rows.push({ st, date: a.d, ib: a.r, sc: b.x }); };
    // minutes between the Inbound start and the truck's time on the scale (1st to 2nd weigh); 0 = unloaded while on site
  const near = (a, b) => {
    if (!isFinite(a.m) || !isFinite(b.m)) return 1e9;
    const end = isFinite(b.m2) && b.m2 > b.m ? b.m2 : b.m;
    return a.m < b.m ? b.m - a.m : a.m > end ? a.m - end : 0;
  };

    // 1 and 2: same plate. Within a plate, pair the closest times first (a truck can come 2–3 times a day).
    [0, 1].forEach(maxD => {
      const cand = [];
      IB.forEach(a => { if (a.used) return; SC.forEach(b => { if (!b.used && a.p === b.p && Math.abs(dayDiff(a.d, b.d)) === maxD) { const g = near(a, b); if (!maxD || g <= DAY_GAP) cand.push([g, a, b]); } }); });
      cand.sort((u, v) => u[0] - v[0]).forEach(([, a, b]) => { if (!a.used && !b.used) pair(a, b, maxD ? 'day' : 'ok'); });
    });
    // 3: one character off. A letter typed wrong (3C/3G, 3R/3E) is likelier than a digit: real fleets run 3G-0499, 0500, 0501…
    const cand = [];
    IB.forEach(a => {
      if (a.used) return;
      SC.forEach(b => {
        if (b.used || edits(a.p, b.p) !== 1) return;
        const dd = Math.abs(dayDiff(a.d, b.d)); if (dd > 1 || (dd && near(a, b) > DAY_GAP)) return;
        const digitsSame = a.p.replace(/\D/g, '') === b.p.replace(/\D/g, '');
        cand.push([(digitsSame ? 0 : 1e7) + dd * 1e6 + Math.min(near(a, b), 999999), a, b]);
      });
    });
    cand.sort((u, v) => u[0] - v[0]).forEach(([, a, b]) => { if (!a.used && !b.used) pair(a, b, 'typo'); });

    // left over
    const outOn = {};   // plate|day of Scale tickets ticked Load: an Inbound truck may have been ticked the wrong way
    allSc.forEach(x => { if (typeOf(x) === 'Out') outOn[norm(x.plate) + '|' + dayOf(x.t1)] = x.no; });
    IB.forEach(a => { if (!a.used) rows.push({ st: 'ib', date: a.d, ib: a.r, sc: null, outNo: outOn[a.p + '|' + a.d] || '' }); });
    SC.forEach(b => { if (!b.used) rows.push({ st: 'sc', date: b.d, ib: null, sc: b.x }); });

    rows.forEach(w => {
      w.ibKg = w.ib ? ibKg(w.ib) : '';
      w.scKg = w.sc && w.sc.net !== '' && w.sc.net != null && isFinite(+w.sc.net) ? Math.round(+w.sc.net) : '';
      w.diff = w.ibKg !== '' && w.scKg !== '' && w.sc.status === 'Done' ? w.scKg - w.ibKg : '';
    });
    const ord = { ib: 0, sc: 1, typo: 2, day: 3, ok: 4 };
    const tm = w => (w.ib ? w.ib.date + ' ' + (w.ib.start || '') : String(w.sc.t1 || '').replace('T', ' '));
    return rows.filter(w => w.date >= from && w.date <= to).sort((u, v) => (u.date < v.date ? 1 : u.date > v.date ? -1 : ord[u.st] - ord[v.st] || (tm(u) < tm(v) ? -1 : 1)));
  }

  const API = { norm, edits, typeOf, match, ibKg, addDays };
  if (typeof module !== 'undefined' && module.exports) module.exports = API; else root.GSCORE = API;
})(typeof window !== 'undefined' ? window : this);
