// Truck Scale: the parts with no screen, so they can be tested on their own (node web/scale/test-core.js).
//   parse()     reads what the Keli XK3118K8 indicator sends over its RS-232 cable
//   Stable      decides when the weight has stopped moving
//   finish()    gross / tare / net and the warnings (unusual empty weight, overload) at the 2nd weigh
//   nextNo()    ticket numbers made on the scale PC, so it keeps working offline
//   jpegPdf()   wraps the ticket picture in a one-page A4 PDF (no PDF library needed)
(function (root) {
  'use strict';

  /**
   * Splits the bytes received so far into weights. Returns { weights: [{ kg, stable? }], rest } where rest is the
   * unfinished end to keep for next time. fmt: 'auto' | 'keli' | 'stx' | 'line'.
   *  keli  Keli continuous output (tF = 0): "=" then the displayed digits LOWEST FIRST, e.g. 32440 kg -> "=04423000"
   *  stx   Keli / Yaohua frame (tF = 1): STX, sign, 6 digits, decimal places, 2 check bytes, ETX
   *  line  one reading per line, e.g. "ST,GS,+0032440kg" (ST = stable, US = moving)
   */
  function parse(buf, fmt) {
    buf = String(buf || '');
    let f = fmt || 'auto';
    if (f === 'auto') f = buf.indexOf('\x02') >= 0 ? 'stx' : buf.indexOf('=') >= 0 ? 'keli' : 'line';
    const weights = [];
    let rest = buf;
    if (f === 'keli') {
      // A frame is complete once the next "=" has arrived (the indicator sends about 10 frames a second).
      const i = buf.lastIndexOf('=');
      const parts = i > 0 ? buf.slice(0, i).split('=').slice(1) : [];
      rest = i >= 0 ? buf.slice(i) : '';
      parts.forEach(p => {
        p = p.replace(/[^0-9.+\-]/g, '');
        if (p.length < 4) return;
        const r = p.split('').reverse().join('');
        const m = r.match(/^([+\-]?)(\d+(?:\.\d+)?)([+\-]?)$/);
        if (!m) return;
        let v = parseFloat(m[2]);
        if (m[1] === '-' || m[3] === '-') v = -v;
        weights.push({ kg: round(v) });
      });
    } else if (f === 'stx') {
      const re = /\x02([+\- ])(\d{6})(\d)[\s\S]{0,2}?\x03/g;
      let m, end = 0;
      while ((m = re.exec(buf))) {
        const v = parseInt(m[2], 10) / Math.pow(10, +m[3]);
        weights.push({ kg: round(m[1] === '-' ? -v : v) });
        end = re.lastIndex;
      }
      rest = buf.slice(end);
      const s = rest.lastIndexOf('\x02');
      rest = s >= 0 ? rest.slice(s) : '';
    } else {
      const lines = buf.split(/\r\n|\r|\n|\x03/);
      rest = lines.pop();
      lines.forEach(l => {
        const nums = l.match(/[+\-]?\s*\d+(?:\.\d+)?/g);
        if (!nums) return;
        let v = parseFloat(nums[nums.length - 1].replace(/\s+/g, ''));
        if (/\bt\b/i.test(l) && !/kg/i.test(l)) v *= 1000;    // weight sent in tonnes
        const w = { kg: round(v) };
        if (/\bUS\b|\bM\b|motion/i.test(l)) w.stable = false;
        else if (/\bST\b/.test(l)) w.stable = true;
        weights.push(w);
      });
    }
    if (rest.length > 200) rest = rest.slice(-200);
    return { weights, rest };
  }
  const round = v => Math.round(v * 100) / 100;

  /** The weight is stable when every reading in the last `ms` is the same (and the indicator doesn't say it is moving). */
  function Stable(ms) {
    const hist = [];
    let flag = null;
    return {
      push(kg, stable, now) {
        now = now || Date.now();
        hist.push([now, kg]);
        while (hist.length > 2 && now - hist[1][0] >= ms) hist.shift();
        flag = stable === undefined ? null : stable;
      },
      get kg() { return hist.length ? hist[hist.length - 1][1] : null; },
      isStable(now) {
        now = now || Date.now();
        if (hist.length < 3 || flag === false) return false;
        if (now - hist[hist.length - 1][0] > 3000) return false;   // no signal
        if (now - hist[0][0] < ms * 0.9) return false;              // not watched long enough yet
        const k = hist[hist.length - 1][1];
        return hist.every(h => h[1] === k);
      },
      reset() { hist.length = 0; flag = null; },
      setMs(v) { ms = v; },
    };
  }

  /**
   * At the 2nd weigh: gross = the bigger weight, tare = the smaller one, net = the difference.
   * Warnings (Kim, 6 Nov 2026): empty weight far from the truck's Empty Weight (kg) in the truck list, gross over Max Gross (kg).
   */
  function finish(w1, w2, truck, tarePct) {
    const gross = Math.max(w1, w2), tare = Math.min(w1, w2), net = gross - tare;
    const warn = [];
    const pct = Number(tarePct) > 0 ? Number(tarePct) : 5;
    const empty = truck && Number(truck.empty) > 0 ? Number(truck.empty) : 0;
    const max = truck && Number(truck.max) > 0 ? Number(truck.max) : 0;
    if (empty) {
      const diff = (tare - empty) / empty * 100;
      if (Math.abs(diff) > pct) warn.push({ k: 'tare', en: 'Empty weight ' + fmt(tare) + ' kg is ' + Math.abs(Math.round(diff)) + '% ' + (diff > 0 ? 'above' : 'below') + ' the truck list (' + fmt(empty) + ' kg)',
        km: 'ទម្ងន់ឡានទទេ ' + fmt(tare) + ' kg ' + (diff > 0 ? 'លើស' : 'ខ្វះ') + ' ' + Math.abs(Math.round(diff)) + '% ពីបញ្ជីឡាន (' + fmt(empty) + ' kg)' });
    }
    if (max && gross > max) warn.push({ k: 'over', en: 'Overload: gross ' + fmt(gross) + ' kg is over the limit ' + fmt(max) + ' kg (+' + fmt(gross - max) + ' kg)',
      km: 'ផ្ទុកលើសទម្ងន់: ' + fmt(gross) + ' kg លើសកំណត់ ' + fmt(max) + ' kg (+' + fmt(gross - max) + ' kg)' });
    if (net <= 0) warn.push({ k: 'zero', en: 'Net weight is ' + fmt(net) + ' kg', km: 'ទម្ងន់សុទ្ធ ' + fmt(net) + ' kg' });
    return { gross, tare, net, warn };
  }
  const fmt = n => Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 });

  /** Next ticket number on this PC: PREFIX-yyMMdd-001, one more than the highest number of today already known. */
  function nextNo(prefix, date, known) {
    const d = date || new Date();
    const p = (prefix || 'WB') + '-' + String(d.getFullYear()).slice(2) + pad(d.getMonth() + 1) + pad(d.getDate()) + '-';
    let max = 0;
    (known || []).forEach(n => { const s = String(n || ''); if (s.indexOf(p) === 0) { const m = s.slice(p.length).match(/^(\d+)/); if (m && +m[1] > max) max = +m[1]; } });
    return p + String(max + 1).padStart(3, '0');
  }
  const pad = n => String(n).padStart(2, '0');

  /** A one-page A4 PDF showing one JPEG (bytes) over the whole page. Returns a Uint8Array. */
  function jpegPdf(jpeg, w, h) {
    const enc = s => { const a = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) a[i] = s.charCodeAt(i) & 255; return a; };
    const W = 595.28, H = 841.89;
    const content = 'q ' + W + ' 0 0 ' + H + ' 0 0 cm /Im0 Do Q';
    const objs = [
      '<< /Type /Catalog /Pages 2 0 R >>',
      '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + W + ' ' + H + '] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>',
      null,
      '<< /Length ' + content.length + ' >>\nstream\n' + content + '\nendstream',
    ];
    const parts = [enc('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n')];
    const offsets = [];
    let len = parts[0].length;
    objs.forEach((o, i) => {
      offsets.push(len);
      let chunk;
      if (i === 3) {
        const head = enc('4 0 obj\n<< /Type /XObject /Subtype /Image /Width ' + w + ' /Height ' + h + ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' + jpeg.length + ' >>\nstream\n');
        const tail = enc('\nendstream\nendobj\n');
        chunk = new Uint8Array(head.length + jpeg.length + tail.length);
        chunk.set(head, 0); chunk.set(jpeg, head.length); chunk.set(tail, head.length + jpeg.length);
      } else chunk = enc((i + 1) + ' 0 obj\n' + o + '\nendobj\n');
      parts.push(chunk); len += chunk.length;
    });
    let xref = 'xref\n0 ' + (objs.length + 1) + '\n0000000000 65535 f \n';
    offsets.forEach(o => { xref += String(o).padStart(10, '0') + ' 00000 n \n'; });
    xref += 'trailer\n<< /Size ' + (objs.length + 1) + ' /Root 1 0 R >>\nstartxref\n' + len + '\n%%EOF\n';
    parts.push(enc(xref));
    const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
    let at = 0;
    parts.forEach(p => { out.set(p, at); at += p.length; });
    return out;
  }

  const api = { parse, Stable, finish, nextNo, jpegPdf, fmt };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SCALECORE = api;
})(typeof window !== 'undefined' ? window : this);
