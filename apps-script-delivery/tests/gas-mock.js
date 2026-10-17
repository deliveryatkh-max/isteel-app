// Small Google Apps Script mock so Delivery.gs and Logic.gs run in Node (run with TZ=Asia/Phnom_Penh).
'use strict';
let DateCtor = Date;   // the script's own Date class (set in makeEnv) so instanceof checks work
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const crypto = require('crypto');

class Range {
  constructor(sh, r, c, nr, nc) { Object.assign(this, { sh, r, c, nr, nc }); }
  getValues() {
    const out = [];
    for (let i = 0; i < this.nr; i++) {
      const row = [];
      for (let j = 0; j < this.nc; j++) { const v = this.sh.get(this.r + i, this.c + j); row.push(v instanceof Date ? new DateCtor(v.getTime()) : v); }
      out.push(row);
    }
    return out;
  }
  getValue() { return this.getValues()[0][0]; }
  setValues(v) {
    if (v.length !== this.nr || v.some(r => r.length !== this.nc)) throw new Error('setValues size mismatch ' + v.length + 'x' + v[0].length + ' vs ' + this.nr + 'x' + this.nc);
    v.forEach((row, i) => row.forEach((x, j) => this.sh.set(this.r + i, this.c + j, x)));
    return this;
  }
  setValue(x) { this.sh.set(this.r, this.c, x); return this; }
  setFontWeight() { return this; }
  setNumberFormat(f) { for (let i = 0; i < this.nr; i++) for (let j = 0; j < this.nc; j++) this.sh.fmt[(this.r + i) + ':' + (this.c + j)] = f; return this; }
}
class Sheet {
  constructor(name, rows) { this.name = name; this.rows = rows.map(r => r.slice()); this.maxRows = Math.max(1000, rows.length + 10); this.writes = 0; this.fmt = {}; }
  get(r, c) { const row = this.rows[r - 1]; const v = row ? row[c - 1] : undefined; return v === undefined || v === null ? '' : v; }
  set(r, c, v) {
    if (r > this.maxRows) throw new Error('row outside sheet');
    // Like Google Sheets: text such as 3E-2588 in a cell that is not Plain text is read as a number (3×10^-2588 = 0).
    if (typeof v === 'string' && this.fmt[r + ':' + c] !== '@' && /^\s*\d+(\.\d+)?E[-+]?\d+\s*$/i.test(v)) v = Number(v); while (this.rows.length < r) this.rows.push([]); this.rows[r - 1][c - 1] = v; this.writes++; }
  getName() { return this.name; }
  getLastRow() { for (let i = this.rows.length; i > 0; i--) if ((this.rows[i - 1] || []).some(x => x !== '' && x != null)) return i; return 0; }
  getLastColumn() { let m = 0; this.rows.forEach(r => r.forEach((x, j) => { if (x !== '' && x != null) m = Math.max(m, j + 1); })); return m; }
  getMaxRows() { return this.maxRows; }
  insertRowsAfter(a, n) { this.maxRows += n; }
  getRange(a, b, c, d) {
    if (typeof a === 'string') return new Range(this, 1, a.charCodeAt(0) - 64, this.maxRows, 1);
    if (a < 1 || b < 1) throw new Error('bad range');
    return new Range(this, a, b, c || 1, d || 1);
  }
  deleteRow(r) { this.rows.splice(r - 1, 1); this.writes++; }
  appendRow(v) { const r = this.getLastRow() + 1; v.forEach((x, j) => this.set(r, j + 1, x)); }
  setFrozenRows() {}
  clear() { this.rows = []; this.fmt = {}; return this; }
}
class SS {
  constructor(sheets) { this.sheets = Object.keys(sheets).map(n => new Sheet(n, sheets[n])); }
  getSheetByName(n) { return this.sheets.find(s => s.name === n) || null; }
  insertSheet(n) { const s = new Sheet(n, []); this.sheets.push(s); return s; }
}

function pad(n, w) { return String(n).padStart(w || 2, '0'); }
function formatDate(d, tz, f) {
  // Node runs with TZ=Asia/Phnom_Penh, so local time = Cambodia time.
  return f.replace(/yyyy|yy|MM|dd|HH|mm|ss/g, t => ({ yyyy: d.getFullYear(), yy: pad(d.getFullYear() % 100), MM: pad(d.getMonth() + 1), dd: pad(d.getDate()), HH: pad(d.getHours()), mm: pad(d.getMinutes()), ss: pad(d.getSeconds()) })[t]);
}

function makeEnv(sheets, opts) {
  opts = opts || {};
  const ss = new SS(sheets);
  const props = Object.assign({ GOOGLE_CLIENT_ID: 'cid', SESSION_SECRET: 'sess-secret', LINK_SECRET: 'link-secret', PHOTO_FOLDER_ID: 'folder1' }, opts.props || {});
  const cache = {};
  const files = [];
  const triggers = [], telegram = [];
  let clock = opts.now || Date.parse('2026-10-12T08:00:00+07:00');
  const RealDate = Date;
  class FakeDate extends RealDate {
    constructor(...a) { if (a.length) super(...a); else super(clock); }
    static now() { return clock; }
  }
  DateCtor = FakeDate;
  const toBytes = s => (typeof s === 'string' ? Buffer.from(s, 'utf8') : Buffer.from(s));
  const ctx = {
    console, JSON, Math, Number, String, Array, Object, Boolean, RegExp, Error, Set, Map, parseInt, parseFloat, isNaN, encodeURIComponent,
    Date: FakeDate, module: undefined,
    SpreadsheetApp: { getActive: () => ss },
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => (k in props ? props[k] : null), setProperty: (k, v) => { props[k] = v; } }) },
    CacheService: { getScriptCache: () => ({ get: k => (k in cache ? cache[k] : null), put: (k, v) => { cache[k] = v; }, remove: k => { delete cache[k]; } }) },
    LockService: { getScriptLock: () => ({ tryLock: () => true, waitLock: () => true, releaseLock: () => {} }) },
    ContentService: { createTextOutput: s => ({ text: s, setMimeType() { return this; } }), MimeType: { JSON: 'json' } },
    ScriptApp: { getProjectTriggers: () => triggers, newTrigger: fn => ({ timeBased: () => ({ everyMinutes: () => ({ create: () => { triggers.push({ getHandlerFunction: () => fn }); } }) }) }) },
    UrlFetchApp: { fetch: (url, o) => {
      if (/api\.telegram\.org/.test(url)) { telegram.push(JSON.parse(o.payload)); return { getResponseCode: () => 200, getContentText: () => '{"ok":true}' }; }
      const tok = decodeURIComponent(url.split('id_token=')[1]);
      const m = tok.match(/^google:(.+)$/);
      return m ? { getResponseCode: () => 200, getContentText: () => JSON.stringify({ aud: 'cid', email: m[1], email_verified: 'true', exp: Math.floor(clock / 1000) + 3600 }) }
        : { getResponseCode: () => 400, getContentText: () => '{}' };
    } },
    DriveApp: {
      getFolderById: () => ({ createFile: b => { files.push(b); return { getUrl: () => 'https://drive.google.com/file/d/f' + files.length }; } }),
      createFolder: () => ({ getId: () => 'newfolder' }),
    },
    Session: { getScriptTimeZone: () => 'Asia/Phnom_Penh' },
    Utilities: {
      formatDate,
      getUuid: () => crypto.randomUUID(),
      base64EncodeWebSafe: d => toBytes(d).toString('base64').replace(/\+/g, '-').replace(/\//g, '_'),
      base64DecodeWebSafe: s => [...Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64')],
      base64Decode: s => [...Buffer.from(s, 'base64')],
      computeHmacSha256Signature: (v, k) => [...crypto.createHmac('sha256', k).update(v).digest()],
      computeDigest: (alg, v) => [...crypto.createHash('sha256').update(v).digest()],
      DigestAlgorithm: { SHA_256: 'sha256' },
      newBlob: (data, type, name) => ({ getBytes: () => [...toBytes(data)], getDataAsString: () => Buffer.from(data).toString('utf8'), type, name }),
    },
  };
  vm.createContext(ctx);
  const dir = path.join(__dirname, '..');
  ['Logic.gs', 'Delivery.gs', 'Extras.gs'].forEach(f => vm.runInContext(fs.readFileSync(path.join(dir, f), 'utf8'), ctx, { filename: f }));
  const env = {
    ss, props, cache, files, ctx, triggers, telegram,
    setNow: t => { clock = typeof t === 'number' ? t : Date.parse(t); },
    advance: ms => { clock += ms; },
    now: () => clock,
    call(action, payload, token) {
      const out = ctx.doPost({ postData: { contents: JSON.stringify({ action, payload, token: token === undefined ? env.token : token }) } });
      const res = JSON.parse(out.text);
      if (res.session) env.token = res.session;
      return res;
    },
    run: code => vm.runInContext(code, ctx),
    token: null,
  };
  return env;
}

module.exports = { makeEnv, formatDate };
