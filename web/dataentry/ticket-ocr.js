// Reads one ISI STEEL weighing ticket (ប័ណ្ណថ្លឹង) with Tesseract (free, runs on this computer, no AI service).
// 1. Read the whole page once and find printed English words that are always on the ticket (WEIGHING, TICKET, Date,
//    (Product), (Customer), (Date/Time), (Price), (Amount), (Type, Operator).
// 2. From where those words are, work out where each yellow box of the sample ticket is on this image.
// 3. Read each box on its own (numbers only), then check the result against the whole-page text.
(function (root) {
  'use strict';

  // Positions on the reference ticket (the sample scaled to 1540 px wide). x, y = centre of the word.
  const REF_W = 1540, REF_H = 942;
  const ANCHORS = [
    { re: /^\(?WEIGHING$/i, x: 782, y: 147 },
    { re: /^TICKET\)?$/i, x: 994, y: 147 },
    { re: /^Date$/i, x: 1186, y: 154 },
    { re: /^\(Product\)?$/i, x: 283, y: 225 },
    { re: /^\(Customer\)?$/i, x: 252, y: 295 },
    { re: /^\(?Date\/Time\)?$/i, x: 838, y: 377, nth: 0 },
    { re: /^\(?Date\/Time\)?$/i, x: 856, y: 471, nth: 1 },
    { re: /^\(Price\)?$/i, x: 840, y: 549 },
    { re: /^\(Amount\)?$/i, x: 863, y: 613 },
    { re: /^\(Type$/i, x: 207, y: 717 },
    { re: /Operator\)?$/i, x: 1290, y: 839 },
  ];
  // The yellow boxes, on the reference ticket: [x0, y0, x1, y1].
  const ZONES = {
    date:    { box: [1222, 122, 1480, 180], chars: '0123456789/' },
    vehicle: { box: [916, 268, 1252, 344], chars: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-' },
    ticket:  { box: [1262, 268, 1512, 344], chars: '0123456789,' },
    gross:   { box: [330, 338, 548, 398], chars: '0123456789,' },
    tare:    { box: [330, 424, 548, 486], chars: '0123456789,' },
    net:     { box: [330, 512, 548, 576], chars: '0123456789,' },
    inTime:  { box: [1000, 352, 1470, 410], chars: '0123456789/:APM ' },
    outTime: { box: [1000, 444, 1470, 502], chars: '0123456789/:APM ' },
  };

  const pad2 = n => String(n).padStart(2, '0');
  const num = s => { const d = String(s || '').replace(/[^0-9]/g, ''); return d ? Number(d) : null; };

  function words(data) {
    const out = [];
    (data.blocks || []).forEach(b => (b.paragraphs || []).forEach(p => (p.lines || []).forEach(l => (l.words || []).forEach(w => {
      out.push({ text: w.text, x: (w.bbox.x0 + w.bbox.x1) / 2, y: (w.bbox.y0 + w.bbox.y1) / 2, conf: w.confidence });
    }))));
    return out;
  }

  // Scale + shift that best moves the reference ticket onto this image (least squares), from the words found.
  function fit(ws, W, H) {
    const pairs = [];
    const seen = {};
    ANCHORS.forEach(a => {
      const hits = ws.filter(w => a.re.test(w.text)).sort((p, q) => p.y - q.y);
      const k = String(a.re);
      const i = a.nth || 0;
      if (hits.length > i) { pairs.push({ rx: a.x, ry: a.y, x: hits[i].x, y: hits[i].y }); seen[k] = 1; }
    });
    let s, tx, ty;
    if (pairs.length >= 2) {
      const n = pairs.length;
      const mrx = pairs.reduce((a, p) => a + p.rx, 0) / n, mry = pairs.reduce((a, p) => a + p.ry, 0) / n;
      const mx = pairs.reduce((a, p) => a + p.x, 0) / n, my = pairs.reduce((a, p) => a + p.y, 0) / n;
      let num_ = 0, den = 0;
      pairs.forEach(p => { num_ += (p.rx - mrx) * (p.x - mx) + (p.ry - mry) * (p.y - my); den += (p.rx - mrx) ** 2 + (p.ry - mry) ** 2; });
      s = den ? num_ / den : W / REF_W;
      // Drop words that landed far from where the others say they should be (OCR picked the wrong word), fit again.
      const good = pairs.filter(p => Math.hypot(mx + (p.rx - mrx) * s - p.x, my + (p.ry - mry) * s - p.y) < 40 * s);
      if (good.length >= 2 && good.length < pairs.length) return fit2(good, W, H);
      tx = mx - mrx * s; ty = my - mry * s;
    } else {
      s = Math.min(W / REF_W, H / REF_H); tx = 0; ty = 0;   // no words found: assume the ticket fills the picture
    }
    return { s, tx, ty, anchors: pairs.length };
  }
  function fit2(pairs, W, H) {
    const n = pairs.length;
    const mrx = pairs.reduce((a, p) => a + p.rx, 0) / n, mry = pairs.reduce((a, p) => a + p.ry, 0) / n;
    const mx = pairs.reduce((a, p) => a + p.x, 0) / n, my = pairs.reduce((a, p) => a + p.y, 0) / n;
    let a = 0, d = 0;
    pairs.forEach(p => { a += (p.rx - mrx) * (p.x - mx) + (p.ry - mry) * (p.y - my); d += (p.rx - mrx) ** 2 + (p.ry - mry) ** 2; });
    const s = d ? a / d : W / REF_W;
    return { s, tx: mx - mrx * s, ty: my - mry * s, anchors: n };
  }

  function rect(t, box, W, H) {
    const left = Math.max(0, Math.round(t.tx + box[0] * t.s)), top = Math.max(0, Math.round(t.ty + box[1] * t.s));
    const right = Math.min(W, Math.round(t.tx + box[2] * t.s)), bottom = Math.min(H, Math.round(t.ty + box[3] * t.s));
    return right - left > 4 && bottom - top > 4 ? { left, top, width: right - left, height: bottom - top } : null;
  }

  // ---------- turning text into values ----------
  function parseDate(s) {
    const m = String(s || '').replace(/[|lI]/g, '1').match(/(\d{1,2})\s*[\/.\-:]\s*(\d{1,2})\s*[\/.\-:]\s*(\d{4})/);
    if (!m) return '';
    const d = +m[1], mo = +m[2];
    return d >= 1 && d <= 31 && mo >= 1 && mo <= 12 ? `${m[3]}-${pad2(mo)}-${pad2(d)}` : '';
  }
  function parseTime(s) {
    const m = String(s || '').match(/(\d{1,2})\s*[:.\-]\s*(\d{2})\s*[:.\-]?\s*(\d{2})?\s*([AP])?\s*\.?\s*M?/i);
    if (!m) return '';
    let h = +m[1]; const mi = +m[2], se = m[3] ? +m[3] : 0;
    const ap = (m[4] || '').toUpperCase();
    if (ap === 'P' && h < 12) h += 12;
    if (ap === 'A' && h === 12) h = 0;
    return h < 24 && mi < 60 && se < 60 ? `${pad2(h)}:${pad2(mi)}:${pad2(se)}` : '';
  }
  // "31/10/2026 12:57:12PM" -> "2026-10-31 12:57:12". A time whose date is unreadable comes back as "12:57:12";
  // the ticket date is put in front later. Slashes are sometimes read as 1 or 7 ("3171072026"): fixed by position.
  function parseDateTime(s) {
    s = String(s || '').trim();
    const tm = s.match(/(\d{1,2})\s*[:.]\s*(\d{2})\s*[:.]\s*(\d{2})\s*([AP])?\s*\.?\s*M?\s*$/i) || s.match(/(\d{1,2})\s*[:.]\s*(\d{2})\s*[:.]\s*(\d{2})/);
    const t = tm ? parseTime(tm[0]) : '';
    const head = tm ? s.slice(0, tm.index) : s;
    let d = parseDate(head);
    if (!d) { const m = head.replace(/\s/g, '').match(/^(\d{2})\d(\d{2})\d(\d{4})$/); if (m) d = parseDate(m[1] + '/' + m[2] + '/' + m[3]); }
    return d && t ? `${d} ${t}` : t || d || '';
  }
  // Plates look like 3B5956, 2A-1234, 3E-2588. OCR mixes up O/0, I/1, S/5, B/8 in the number part.
  function parsePlate(s) {
    const c = String(s || '').toUpperCase().replace(/[^A-Z0-9-]/g, '');
    const m = c.match(/([0-9OIL])([A-Z0-9]{1,2})-?([0-9OISBZ]{4})/);
    if (!m) return c.slice(0, 12);
    const fixD = x => x.replace(/O/g, '0').replace(/[IL]/g, '1').replace(/S/g, '5').replace(/B/g, '8').replace(/Z/g, '2');
    const fixL = x => x.replace(/0/g, 'O').replace(/8/g, 'B').replace(/5/g, 'S').replace(/1/g, 'I');
    let letters = m[2];
    if (letters.length === 2 && /\d/.test(letters[1]) && !/\d/.test(letters[0])) letters = letters;   // e.g. "A1" stays
    else letters = letters.length === 1 ? fixL(letters) : letters;
    return fixD(m[1]) + letters + fixD(m[3]);
  }

  // Values found in the whole-page text, used when a box read failed.
  function fromText(text) {
    const t = String(text || '');
    const o = {};
    const kg = re => { const m = t.match(re); return m ? num(m[1]) : null; };
    o.gross = kg(/Gross\)?\s*[:;]?\s*([\d,.]{3,})\s*k/i);
    o.tare = kg(/Tare\)?\s*[:;]?\s*([\d,.]{3,})\s*k/i);
    o.net = kg(/Net\)?\W{0,4}([\d,.]{3,})\s*k/i);
    const dm = t.match(/Date\s*[:]?\s*(\d{1,2}\/\d{1,2}\/\d{4})/i);
    o.date = dm ? parseDate(dm[1]) : '';
    const dts = [];
    t.replace(/(\d{1,2}[\/:.]\d{1,2}[\/:.]\d{4})\s+(\d{1,2}[:.\-]\d{2}[:.\-]\d{2}\s*[AP]\s*M)/gi, (all) => { dts.push(parseDateTime(all)); return all; });
    o.inTime = dts[0] || ''; o.outTime = dts[1] || '';
    const pm = t.match(/\b(\d[A-Z]{1,2}-?\d{4})\b/);
    o.vehicle = pm ? pm[1] : '';
    return o;
  }

  /**
   * worker: a Tesseract worker made with createWorker('eng'). image: what worker.recognize takes (canvas, URL, buffer).
   * W, H: image size in px. Returns { fields, raw, checks, anchors }.
   */
  async function read(worker, image, W, H, onStep) {
    const step = (p, msg) => { if (onStep) onStep(p, msg); };
    step(0.05, 'page');
    await worker.setParameters({ tessedit_pageseg_mode: '11', tessedit_char_whitelist: '', preserve_interword_spaces: '0' });
    const page = await worker.recognize(image, {}, { blocks: true, text: true });
    const ws = words(page.data);
    const t = fit(ws, W, H);
    const text = page.data.text || '';
    const backup = fromText(text);
    const raw = { page: text };
    const keys = Object.keys(ZONES);
    const got = {};
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i], z = ZONES[k];
      step(0.15 + 0.8 * i / keys.length, k);
      const r = rect(t, z.box, W, H);
      if (!r) continue;
      await worker.setParameters({ tessedit_pageseg_mode: '7', tessedit_char_whitelist: z.chars });
      const res = await worker.recognize(image, { rectangle: r }, { text: true });
      raw[k] = (res.data.text || '').trim();
      got[k] = raw[k];
    }
    await worker.setParameters({ tessedit_pageseg_mode: '3', tessedit_char_whitelist: '' });

    const f = {
      date: parseDate(got.date) || backup.date,
      vehicle: parsePlate(got.vehicle) || backup.vehicle,
      ticket: num(got.ticket) != null ? String(num(got.ticket)) : '',
      gross: num(got.gross), tare: num(got.tare), net: num(got.net),
      inTime: parseDateTime(got.inTime), outTime: parseDateTime(got.outTime),
    };
    ['gross', 'tare', 'net'].forEach(k => { if (f[k] == null || f[k] < 10) f[k] = backup[k]; });
    // Gross - Tare = Net: when two of them agree, fix the third.
    const g = f.gross, ta = f.tare, n = f.net;
    if (g != null && ta != null && n != null && g - ta !== n) {
      if (backup.gross != null && backup.gross - ta === n) f.gross = backup.gross;
      else if (backup.tare != null && g - backup.tare === n) f.tare = backup.tare;
      else if (backup.net != null && g - ta === backup.net) f.net = backup.net;
    }
    if (f.net == null && g != null && ta != null) f.net = g - ta;
    // A box read that has no time: use the whole-page text.
    ['inTime', 'outTime'].forEach(k => { if (!/\d\d:\d\d/.test(f[k] || '')) f[k] = backup[k] || f[k]; });
    // A time without its date: take the ticket date.
    ['inTime', 'outTime'].forEach(k => { if (f[k] && !/^\d{4}-/.test(f[k]) && f.date) f[k] = f.date + ' ' + f[k]; });
    if (!f.date && f.inTime) f.date = f.inTime.slice(0, 10);
    const checks = {
      weight: f.gross != null && f.tare != null && f.net != null ? f.gross - f.tare === f.net : null,
      times: f.inTime && f.outTime ? f.outTime > f.inTime : null,
    };
    step(1, 'done');
    return { fields: f, raw, checks, anchors: t.anchors };
  }

  const api = { read, parseDate, parseTime, parseDateTime, parsePlate, fromText, REF_W, REF_H };
  if (typeof module === 'object' && module.exports) module.exports = api; else root.TicketOCR = api;
})(typeof self !== 'undefined' ? self : this);
