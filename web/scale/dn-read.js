// Reads a 3PL Debit Note (PDF, scanned PDF or photo) into trips, for the Debit Note check (Kim, 6 Nov 2026).
// Digital PDFs give their text directly (pdf.js); scanned pages and photos are read with Tesseract on this PC
// (free, no AI service). Each trip line looks like: "1  23-Sep-26  3E-9044  29.24  $ 8.50  $ 2.50  $ 321.64  <place>".
(function (root) {
  'use strict';
  const VENDOR = '../vendor/';
  const MON = { JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6, JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12 };
  const pad = n => String(n).padStart(2, '0');
  const load = src => new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('Could not load ' + src)); document.head.appendChild(s); });
  let pdfP = null, ocrP = null;
  const pdfjs = () => pdfP || (pdfP = load(VENDOR + 'pdfjs/pdf.min.js').then(() => { pdfjsLib.GlobalWorkerOptions.workerSrc = VENDOR + 'pdfjs/pdf.worker.min.js'; return pdfjsLib; }));
  const ocr = () => ocrP || (ocrP = (async () => {
    if (!root.Tesseract) await load(VENDOR + 'tesseract/tesseract.min.js');
    const w = await Tesseract.createWorker('eng', 1, { workerPath: VENDOR + 'tesseract/worker.min.js', corePath: VENDOR + 'tesseract/', langPath: VENDOR + 'tesseract', gzip: true, workerBlobURL: false, cacheMethod: 'write' });
    await w.setParameters({ tessedit_pageseg_mode: '6', preserve_interword_spaces: '1' });   // one block of text, keep the columns apart
    return w;
  })().catch(e => { ocrP = null; throw e; }));

  /** Black and white, about 2400 px wide: grey shading (like the highlighted rows) turns white, ink stays black. */
  function clean(src) {
    const k = Math.min(3, 2400 / src.width);
    const c = document.createElement('canvas'); c.width = Math.round(src.width * k); c.height = Math.round(src.height * k);
    const x = c.getContext('2d', { willReadFrequently: true });
    x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.imageSmoothingQuality = 'high'; x.drawImage(src, 0, 0, c.width, c.height);
    const img = x.getImageData(0, 0, c.width, c.height), d = img.data;
    const W = c.width, H = c.height, ink = new Uint8Array(W * H);
    for (let i = 0, j = 0; i < d.length; i += 4, j++) ink[j] = (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) < 160 ? 1 : 0;
    // Table lines confuse the reader: wipe long straight runs of ink (a letter is never this long).
    const wipe = new Uint8Array(W * H), LONG = Math.round(W / 25);
    for (let y = 0; y < H; y++) for (let x0 = 0; x0 < W;) {
      if (!ink[y * W + x0]) { x0++; continue; }
      let x1 = x0; while (x1 < W && ink[y * W + x1]) x1++;
      if (x1 - x0 > LONG) for (let k = x0; k < x1; k++) wipe[y * W + k] = 1;
      x0 = x1;
    }
    const TALL = Math.round(H / 60);
    for (let x0 = 0; x0 < W; x0++) for (let y0 = 0; y0 < H;) {
      if (!ink[y0 * W + x0]) { y0++; continue; }
      let y1 = y0; while (y1 < H && ink[y1 * W + x0]) y1++;
      if (y1 - y0 > TALL) for (let k = y0; k < y1; k++) wipe[k * W + x0] = 1;
      y0 = y1;
    }
    for (let i = 0, j = 0; j < ink.length; i += 4, j++) { const v = ink[j] && !wipe[j] ? 0 : 255; d[i] = d[i + 1] = d[i + 2] = v; }
    x.putImageData(img, 0, 0);
    return c;
  }
  async function ocrLines(canvas, onStep) {
    const w = await ocr();
    if (onStep) onStep('ocr');
    const r = await w.recognize(clean(canvas));
    return String(r.data.text || '').split(/\n+/);
  }
  /** Text lines of a digital PDF page, grouped by height on the page. */
  async function textLines(page) {
    const tc = await page.getTextContent();
    const rows = [];
    tc.items.forEach(it => {
      const s = String(it.str || ''); if (!s.trim()) return;
      const y = it.transform[5], x = it.transform[4];
      let r = rows.find(q => Math.abs(q.y - y) < 3);
      if (!r) rows.push(r = { y, parts: [] });
      r.parts.push({ x, s });
    });
    return rows.sort((a, b) => b.y - a.y).map(r => r.parts.sort((a, b) => a.x - b.x).map(p => p.s).join('  '));
  }

  /** file: a PDF or image File. Returns { lines, pages, scanned }. */
  async function readFile(file, onStep) {
    let lines = [], scanned = false, pages = 0;
    if (/pdf$/i.test(file.type) || /\.pdf$/i.test(file.name)) {
      const lib = await pdfjs();
      const doc = await lib.getDocument({ data: await file.arrayBuffer() }).promise;
      pages = Math.min(doc.numPages, 10);
      for (let p = 1; p <= pages; p++) {
        const page = await doc.getPage(p);
        const tl = await textLines(page);
        if (tl.join(' ').replace(/\s/g, '').length > 80) { lines = lines.concat(tl); continue; }
        scanned = true;
        const v1 = page.getViewport({ scale: 1 }), vp = page.getViewport({ scale: Math.min(4, 2400 / v1.width) });
        const c = document.createElement('canvas'); c.width = Math.round(vp.width); c.height = Math.round(vp.height);
        await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
        lines = lines.concat(await ocrLines(c, onStep));
      }
    } else {
      scanned = true; pages = 1;
      const bmp = await createImageBitmap(file);
      const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height; c.getContext('2d').drawImage(bmp, 0, 0);
      lines = await ocrLines(c, onStep);
    }
    return { lines, pages, scanned };
  }

  function ymd(d, m, y) {
    const k = String(m).toUpperCase().replace(/0/g, 'O').replace(/5/g, 'S').replace(/8/g, 'S').replace(/1/g, 'I').slice(0, 3);
    let mm = MON[k];
    if (!mm) { const two = Object.keys(MON).filter(n => (n[0] === k[0]) + (n[1] === k[1]) + (n[2] === k[2]) >= 2); if (two.length === 1) mm = MON[two[0]]; }
    d = +d; y = +y; if (y < 100) y += 2000;
    if (!mm || !d || d > 31 || y < 2020 || y > 2040) return '';
    return y + '-' + pad(mm) + '-' + pad(d);
  }
  /** Plate as the truck list writes it: 3E-9044, 2AD-9220. Common reading slips (O for 0, I for 1, 6 for G) are fixed. */
  function plateOf(a, b) {
    const dig = s => s.replace(/O/g, '0').replace(/[IL|]/g, '1').replace(/S/g, '5').replace(/B/g, '8');
    const let_ = s => s.replace(/0/g, 'O').replace(/1/g, 'I').replace(/5/g, 'S').replace(/8/g, 'B').replace(/6/g, 'G');
    return dig(a.slice(0, 1)) + let_(a.slice(1)) + '-' + dig(b);
  }
  // Every number on a Debit Note line has 2 decimals (29.24, 8.50, 321.64). A reader that lost the point gives 2924: put it back.
  const money = s => { const t = String(s).replace(/,/g, ''); if (/\.\d/.test(t)) return parseFloat(t); const v = parseInt(t.replace(/\D/g, ''), 10); return isFinite(v) ? v / 100 : null; };
  const near = (a, b, tol) => Math.abs(a - b) <= tol;
  const mode = list => { const c = {}; let best = null; list.forEach(v => { if (v == null) return; c[v] = (c[v] || 0) + 1; if (best == null || c[v] > c[best]) best = v; }); return best == null ? null : +best; };

  /** Lines of text → { agent, no, date, deliveryTo, customer, total, rows: [{ n, date, plate, qty, price, extra, total, place, ok, line }], unread } */
  function parse(lines) {
    const out = { agent: '', no: '', date: '', deliveryTo: '', customer: '', total: null, rows: [], unread: [] };
    const all = lines.join('\n');
    const g = (re) => { const m = all.match(re); return m ? m[1].trim() : ''; };
    out.agent = g(/Transportation\s*Agent\s*[:;.]?\s*([A-Z][A-Za-z0-9 .&()'-]{2,40}?)(?:\s{2,}|\s+Vendor|\n|$)/i);
    out.no = g(/\bNo\s*[:;.]\s*([A-Z0-9][A-Z0-9-]{4,})/i);
    out.deliveryTo = g(/Delivery\s*to\s*[:;.]?\s*([^\n]{2,40}?)(?:\s{2,}|\n|$)/i);
    out.customer = g(/Customer\s*[:;.]?\s*([^\n]{2,40}?)(?:\s{2,}|\n|$)/i);
    const dm = all.match(/Date\s*[:;.]\s*(\d{1,2})[\s-]*([A-Za-z0-9]{3})[a-z]*[\s-]*(\d{2,4})/i);
    if (dm) out.date = ymd(dm[1], dm[2], dm[3]);
    const tm = all.match(/Total\s*:?[^\n]*?\$\s*([\d,]+\.\d{2})/i);
    if (tm) out.total = parseFloat(tm[1].replace(/,/g, ''));
    const raw = [];
    lines.forEach(line => {
      const L = String(line).replace(/[“”"'‘’»«]/g, ' ').replace(/[$§]/g, ' $ ');
      if (/total|cost\s*center|\bGL\b|vendor/i.test(L)) return;
      const p = L.match(/(?:^|[^A-Za-z0-9])([0-9OIl](?=[A-Z0-9]{0,2}[A-Z])[A-Z0-9]{1,3}|[0-9]{2}(?=\s*[-–]))\s*[-–.]?\s*([0-9OIlSB]{4})(?![0-9A-Za-z])/);
      if (!p) return;
      const head = L.slice(0, p.index + 1);
      let date = '';
      for (const d of head.matchAll(/(\d{1,2})\s*[-–.\/: ]?\s*([A-Za-z05][A-Za-z]{2})[a-z]*\s*[-–.\/ ]?\s*(\d{2,4})/g)) { date = ymd(d[1], d[2], d[3]); if (date) break; }
      const lead = head.match(/^\D{0,3}(\d{1,2})\s/);
      const rest = L.slice(p.index + p[0].length);
      const place = (rest.match(/[^\x00-\x7F][^$]*$/) || [''])[0].trim();
      const ns = (rest.replace(place, '').match(/\d[\d,]*\.?\d*/g) || []).filter(x => x.replace(/\D/g, '').length >= 3).map(money);
      if (!ns.length) { out.unread.push(line); return; }
      raw.push({ n: lead ? +lead[1] : null, date, plate: plateOf(p[1].toUpperCase(), p[2].toUpperCase()), ns, place, line: String(line).trim() });
    });
    // Price and extra charge are mostly the same on every line: use the common ones to fill what the reader missed.
    const P = mode(raw.filter(r => r.ns.length >= 4).map(r => r.ns[1])), X = mode(raw.filter(r => r.ns.length >= 4).map(r => r.ns[2])) || 0;
    raw.forEach((r, i) => {
      // total = the biggest number; anything after it is noise (the place column read as letters and digits)
      let ns = r.ns.slice(), ti = ns.length > 1 ? ns.indexOf(Math.max.apply(null, ns.slice(1))) : -1;
      let total = ti > 0 && ns[ti] > ns[0] * 2 ? ns[ti] : null;
      if (total != null) ns = ns.slice(0, ti);
      let qty = ns[0], mid = ns.slice(1, 3), price = null, extra = X;
      if (mid.length === 2) { price = mid[0]; extra = mid[1]; }
      else if (mid.length === 1) { if (P != null && near(mid[0], X, 0.001) && !near(mid[0], P, 0.001)) extra = mid[0]; else price = mid[0]; }
      const fits = (q, pr, ex) => q > 3 && q < 80 && pr != null && total != null && near(q * (pr + ex), total, 0.06);
      let ok = fits(qty, price, extra);
      if (!ok && total != null) {
        const tries = [];
        [price, P].forEach(pr => [extra, X].forEach(ex => { if (pr != null) tries.push([qty, pr, ex]); }));
        if (qty) [extra, X].forEach(ex => { const pr = Math.round((total / qty - ex) * 100) / 100; if (pr > 0 && pr < 100 && near(pr * 4, Math.round(pr * 4), 0.02)) tries.push([qty, pr, ex]); });
        [price, P].forEach(pr => [extra, X].forEach(ex => { if (pr != null) tries.push([Math.round(total / (pr + ex) * 100) / 100, pr, ex]); }));
        const hit = tries.find(x => fits(x[0], x[1], x[2]));
        if (hit) { [qty, price, extra] = hit; ok = true; }
      }
      if (price == null) price = P;
      out.rows.push({ n: r.n || i + 1, date: r.date, plate: r.plate, qty, price, extra, total, place: r.place, ok, line: r.line });
    });
    // A date the reader could not read: take it from the lines around it when they agree (lines go by date).
    out.rows.forEach((r, i) => {
      if (r.date) return;
      const a = out.rows.slice(0, i).reverse().find(x => x.date), b = out.rows.slice(i + 1).find(x => x.date);
      if (a && b && a.date === b.date) r.date = a.date; else { r.date = (a || b || {}).date || ''; r.guess = true; }
    });
    return out;
  }

  root.DnRead = { readFile, parse };
})(window);
