// Small Google Apps Script mock for running Inbound.gs in Node (sheets, Drive, Docs, Mail, Utilities, Telegram).
// Copy of apps-script-incident/tests/gas-ir.js with getParents().
'use strict';
const fs = require('fs');
const vm = require('vm');
const crypto = require('crypto');

const buf = x => (Buffer.isBuffer(x) ? x : typeof x === 'string' ? Buffer.from(x, 'utf8') : Buffer.from(Array.from(x, b => b & 255)));
const signed = b => Array.from(b, x => (x > 127 ? x - 256 : x));
const pad = n => String(n).padStart(2, '0');

class Range {
  constructor(sh, r, c, nr, nc) { Object.assign(this, { sh, r, c, nr, nc }); }
  each(fn) { const out = []; for (let i = 0; i < this.nr; i++) { const row = []; for (let j = 0; j < this.nc; j++) row.push(fn(i, j)); out.push(row); } return out; }
  getValues() { return this.each((i, j) => { const v = (this.sh.rows[this.r - 1 + i] || [])[this.c - 1 + j]; return v == null ? '' : v; }); }
  getDisplayValues() { return this.getValues().map(r => r.map(v => (v instanceof Date ? v.toISOString() : String(v)))); }
  getValue() { return this.getValues()[0][0]; }
  setValues(v) {
    if (v.length !== this.nr || v[0].length !== this.nc) throw new Error('setValues size mismatch');
    v.forEach((row, i) => row.forEach((x, j) => { const R = this.r - 1 + i; (this.sh.rows[R] = this.sh.rows[R] || [])[this.c - 1 + j] = x; }));
    return this;
  }
  setValue(x) { return this.setValues([[x]]); }
  setNumberFormat() { return this; } clearContent() { return this.setValues(this.each(() => '')); } setFontWeight() { return this; } setBackground() { return this; } setFontColor() { return this; }
  insertCheckboxes() { return this; }
}
class Sheet {
  constructor(name, rows) { this.name = name; this.rows = rows || []; }
  getName() { return this.name; }
  getLastRow() { for (let i = this.rows.length; i > 0; i--) if ((this.rows[i - 1] || []).some(x => x !== '' && x != null)) return i; return 0; }
  getLastColumn() { return Math.max(0, ...this.rows.map(r => { let m = 0; (r || []).forEach((x, j) => { if (x !== '' && x != null) m = j + 1; }); return m; })); }
  getMaxRows() { return 1000; }
  getRange(r, c, nr, nc) { if (typeof r === 'string') return new Range(this, 1, 1, 1, 1); return new Range(this, r, c, nr || 1, nc || 1); }
  deleteRow(r) { this.rows.splice(r - 1, 1); }
  setFrozenRows() {}
}
class SS {
  constructor(sheets) { this.sheets = sheets; }
  getSheetByName(n) { return this.sheets.find(s => s.name === n) || null; }
  getSheets() { return this.sheets; }
  insertSheet(n) { const s = new Sheet(n, []); this.sheets.push(s); return s; }
  deleteSheet(s) { this.sheets.splice(this.sheets.indexOf(s), 1); }
}
const iter = arr => { let i = 0; return { hasNext: () => i < arr.length, next: () => arr[i++] }; };

function makeEnv(opts) {
  opts = opts || {};
  const props = Object.assign({}, opts.props || {});
  const cache = {};
  const ss = new SS([new Sheet('Sheet1', [])]);
  const users = new SS([new Sheet('Users', opts.users || []), new Sheet('Driver & Truck', opts.trucks || [])]);
  const files = {}, folders = {};
  let nid = 0;
  const mails = [], docs = {}, telegrams = [];
  const env = { props, ss, users, files, folders, mails, docs, telegrams, errors: [] };

  function blob(data, mime, name) {
    let b = buf(data == null ? '' : data);
    const o = {
      getBytes: () => signed(b), getDataAsString: () => b.toString('utf8'), getContentType: () => mime || 'application/octet-stream',
      getName: () => name, setName(n) { name = n; return o; }, setContentType(m) { mime = m; return o; }, _buf: () => b,
    };
    return o;
  }
  function makeFile(b, parent) {
    const id = 'f' + (++nid);
    const f = { id, name: b.getName(), data: b._buf(), mime: b.getContentType(), parent, trashed: false, desc: '' };
    files[id] = f;
    return fileApi(f);
  }
  function fileApi(f) {
    return {
      getId: () => f.id, getName: () => f.name, getUrl: () => 'https://drive.google.com/file/d/' + f.id,
      getBlob: () => blob(f.data, f.mime, f.name), getMimeType: () => f.mime || '', getLastUpdated: () => new Date(f.updated || 0), setContent(s) { f.data = Buffer.from(String(s), 'utf8'); return this; },
      getAs: mime => blob('%PDF-' + (docs[f.id] ? docs[f.id].parts.join('\n') : ''), mime, f.name + '.pdf'), getThumbnail: () => null, isTrashed: () => f.trashed,
      setDescription(d) { f.desc = d; return this; }, getDescription: () => f.desc, setTrashed(v) { f.trashed = v; return this; },
      moveTo(folder) { f.parent = folder.getId(); return this; },
      getParents: () => iter(folders[f.parent] ? [folderApi(folders[f.parent])] : []),
      makeCopy(n, folder) { const c = Object.assign({}, f, { id: 'f' + (++nid), name: n, parent: folder.getId() }); files[c.id] = c; return fileApi(c); },
    };
  }
  function makeFolder(name, parent) { const id = 'd' + (++nid); folders[id] = { id, name, parent, trashed: false }; return folderApi(folders[id]); }
  function folderApi(d) {
    return {
      getId: () => d.id, getName: () => d.name, getUrl: () => 'https://drive.google.com/drive/folders/' + d.id,
      getFoldersByName: n => iter(Object.values(folders).filter(x => x.parent === d.id && x.name === n && !x.trashed).map(folderApi)),
      getFilesByName: n => iter(Object.values(files).filter(x => x.parent === d.id && x.name === n && !x.trashed).map(fileApi)),
      getFiles: () => iter(Object.values(files).filter(x => x.parent === d.id).map(fileApi)),
      createFolder: n => makeFolder(n, d.id), createFile: b => makeFile(b, d.id), setTrashed(v) { d.trashed = v; return this; },
      getParents: () => iter(folders[d.parent] ? [folderApi(folders[d.parent])] : []),
    };
  }
  // Docs: records what was written so tests can read it back.
  function docApi(id, name) {
    const doc = docs[id] = { id, name, parts: [], images: 0 };
    const img = () => { doc.images++; const o = { getWidth: () => 800, getHeight: () => 600, setWidth: () => o, setHeight: () => o }; return o; };
    const el = text => { const o = { editAsText: () => o, setForegroundColor: () => o, setBold: () => o, setItalic: () => o, setBackgroundColor: () => o, setFontSize: () => o, setHeading: () => o,
      setGlyphType: () => o, setSpacingBefore: () => o, setSpacingAfter: () => o, appendInlineImage: () => img(), appendText: () => o, asParagraph: () => o,
      setAlignment: () => o, asText: () => ({ getText: () => text }), removeFromParent: () => { doc.parts.shift(); } }; return o; };
    const table = rows => { const cell = { setBackgroundColor: () => cell, editAsText: () => cell, setForegroundColor: () => cell, setBold: () => cell, setFontSize: () => cell, getChild: () => el(''),
        setText: () => cell, setWidth: () => cell, setPaddingTop: () => cell, setPaddingBottom: () => cell, setPaddingLeft: () => cell, setPaddingRight: () => cell };
      return { setBorderColor() {}, setBorderWidth() {}, setColumnWidth() {}, getRow: () => ({ getNumCells: () => rows[0].length, getCell: () => cell }), getNumRows: () => rows.length }; };
    const body = {
      setMarginTop: () => body, setMarginBottom: () => body, setMarginLeft: () => body, setMarginRight: () => body, setAttributes: () => body,
      appendParagraph: t => { doc.parts.push(String(t)); return el(t); }, appendListItem: t => { doc.parts.push('• ' + t); return el(t); },
      appendTable: rows => { doc.parts.push(rows.map(r => r.join(' | ')).join('\n')); return table(rows); }, appendPageBreak: () => { doc.parts.push('---'); },
      getNumChildren: () => doc.parts.length, getChild: i => el(doc.parts[i]),
    };
    doc.parts.push('');
    return { getId: () => id, getName: () => name, getUrl: () => 'https://docs.google.com/document/d/' + id, getBody: () => body, saveAndClose() {} };
  }

  // Word template as a Google Doc: paragraphs and tables of placeholder text, filled with findText/insertText/deleteText.
  const TPL = ['GOODS RECEIPT REPORT', '{{id}} · {{date}} · {{status}}',
    [['PO', '{{po}}', 'Inbound', '{{inbound}}'], ['Ref', '{{ref}}', 'Supplier', '{{supplier}}'], ['ETA', '{{eta}}', '3PL DN', '{{dn3pl}}'], ['Truck', '{{truck}}', 'Owner', '{{owner}}']],
    'B. ITEMS ({{itemCount}})',
    [['#', 'Material', 'PO', 'Arr', 'GR', 'Dmg', 'UoM'], ['{{item.no}}', '{{item.material}}', '{{item.poQty}}', '{{item.arrQty}}', '{{item.grQty}}', '{{item.dmgQty}}', '{{item.uom}}'],
      ['', 'Total', '{{totPo}}', '{{totArr}}', '{{totGr}}', '{{totDmg}}', '{{uom}}']],
    [['Start', '{{start}}', 'End', '{{end}}'], ['Spent', '{{spent}}', 'Manpower', '{{manpower}}'], ['Productivity', '{{productivity}}', 'Remark', '{{remark}}']],
    '{{truckPhotos}}', '{{damagePhotos}}', [['By', '{{by}}', 'Finished by', '{{finishedBy}}']]];
  function tplDocApi(id, name) {
    const doc = docs[id] = { id, name, parts: [], images: 0, tpl: true };
    const img = () => { doc.images++; const o = { getWidth: () => 800, getHeight: () => 600, setWidth: () => o, setHeight: () => o }; return o; };
    const para = (str, parent) => {
      const p = { getType: () => 'PARAGRAPH', getParent: () => parent(), appendInlineImage: () => img(), appendText: () => p };
      const t = p.text = { s: str, getType: () => 'TEXT', asText: () => t, getText: () => t.s, getParent: () => p,
        insertText(i, x) { t.s = t.s.slice(0, i) + x + t.s.slice(i); return t; }, deleteText(a, b) { t.s = t.s.slice(0, a) + t.s.slice(b + 1); return t; } };
      return p;
    };
    const find = (paras, pat) => { const re = new RegExp(pat); for (const p of paras()) { const m = re.exec(p.text.s); if (m) return { getElement: () => p.text, getStartOffset: () => m.index, getEndOffsetInclusive: () => m.index + m[0].length - 1 }; } return null; };
    const makeRow = (cells, table) => { const r = { table, getType: () => 'TABLE_ROW', getParent: () => r.table, getParentTable: () => r.table, copy: () => makeRow(r.cells.map(c => c.text.s), null),
      findText: pat => find(() => r.cells, pat), removeFromParent() { r.table.rows.splice(r.table.rows.indexOf(r), 1); } }; r.cells = cells.map(c => para(c, () => r)); return r; };
    const blocks = TPL.map(b => { if (typeof b === 'string') return para(b, () => body); const t = { getChildIndex: r => t.rows.indexOf(r), insertTableRow(i, r) { r.table = t; t.rows.splice(i, 0, r); return r; } }; t.rows = b.map(r => makeRow(r, t)); return t; });
    const all = () => [].concat.apply([], blocks.map(b => b.rows ? [].concat.apply([], b.rows.map(r => r.cells)) : [b]));
    const body = { findText: pat => find(all, pat), editAsText: () => ({ setFontFamily: f => { doc.font = f; } }) };
    return { getId: () => id, getBody: () => body, getHeader: () => null, getFooter: () => null, saveAndClose() { doc.parts = all().map(p => p.text.s); } };
  }

  const sandbox = {
    console: { log: () => {}, warn: () => {}, error: (...a) => env.errors.push(a.join(' ')) },
    SpreadsheetApp: { getActive: () => ss, openById: id => { if (id !== 'USERS') throw new Error('bad id'); return users; } },
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => (k in props ? props[k] : null), setProperty: (k, v) => { props[k] = String(v); } }) },
    CacheService: { getScriptCache: () => ({ get: k => (k in cache ? cache[k] : null), put: (k, v) => { cache[k] = String(v); }, remove: k => { delete cache[k]; } }) },
    LockService: { getScriptLock: () => ({ tryLock: () => true, waitLock: () => {}, releaseLock: () => {} }) },
    Utilities: {
      formatDate: (d, tz, f) => f.replace('yyyy', d.getFullYear()).replace('yy', String(d.getFullYear()).slice(2)).replace('MM', pad(d.getMonth() + 1)).replace('dd', pad(d.getDate()))
        .replace('HH', pad(d.getHours())).replace('mm', pad(d.getMinutes())),
      getUuid: () => crypto.randomUUID(),
      newBlob: blob,
      base64EncodeWebSafe: x => buf(x).toString('base64').replace(/\+/g, '-').replace(/\//g, '_'),
      base64DecodeWebSafe: s => signed(Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64')),
      base64Encode: x => buf(x).toString('base64'),
      base64Decode: s => signed(Buffer.from(String(s), 'base64')),
      computeHmacSha256Signature: (v, k) => signed(crypto.createHmac('sha256', buf(k)).update(buf(v)).digest()),
      computeDigest: (a, t) => signed(crypto.createHash('sha256').update(buf(t)).digest()),
      DigestAlgorithm: { SHA_256: 'SHA_256', MD5: 'MD5' },
    },
    ContentService: { createTextOutput: s => ({ s, setMimeType() { return this; } }), MimeType: { JSON: 'json' } },
    DriveApp: {
      createFolder: n => makeFolder(n, 'root'),
      getFolderById: id => { if (!folders[id]) throw new Error('no folder'); return folderApi(folders[id]); },
      getFileById: id => fileApi(files[id] || (files[id] = { id, name: 'Template', data: Buffer.from(''), parent: 'root' })),
    },
    DocumentApp: {
      create: n => { const d = makeFile(blob('', 'application/vnd.google-apps.document', n), 'root'); return docApi(d.getId(), n); },
      openById: id => (files[id] && files[id].tpl ? tplDocApi : docApi)(id, files[id] ? files[id].name : id),
      ElementType: { TABLE_ROW: 'TABLE_ROW', PARAGRAPH: 'PARAGRAPH' },
      Attribute: { FONT_FAMILY: 'FONT_FAMILY', FONT_SIZE: 'FONT_SIZE' },
      HorizontalAlignment: { RIGHT: 'R' }, ParagraphHeading: { TITLE: 'T', SUBTITLE: 'S', HEADING2: 'H2' }, GlyphType: { BULLET: 'B' },
    },
    MailApp: { getRemainingDailyQuota: () => 100, sendEmail: o => mails.push(o) },
    ScriptApp: { getOAuthToken: () => 'oauth' },
    UrlFetchApp: {
      fetch: (url, o) => {
        if (/api\.telegram\.org/.test(url)) { telegrams.push({ method: url.split('/').pop(), payload: o.payload }); return { getContentText: () => '{"ok":true}' }; }
        if (/export\?format=docx/.test(url)) return { getResponseCode: () => 200, getBlob: () => blob('PK-docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'x.docx') };
        if (/ib-template\.docx$/.test(url)) return { getBlob: () => blob('PK-docx', 'application/octet-stream', 't.docx') };
        if (/upload\/drive\/v3\/files/.test(url)) { const id = 'f' + (++nid); files[id] = { id, name: 'Inbound Report Template', data: Buffer.from(''), parent: 'root', trashed: false, tpl: true }; env.templateUploads = (env.templateUploads || 0) + 1; return { getResponseCode: () => 200, getContentText: () => JSON.stringify({ id }) }; }
        if (/tokeninfo/.test(url)) return { getResponseCode: () => 400, getContentText: () => '{}' };
        throw new Error('unexpected fetch ' + url);
      },
    },
    Math, JSON, Date, String, Number, Array, Object, RegExp, Error, Set, isFinite, isNaN, parseInt,
  };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(opts.file, 'utf8'), sandbox, { filename: 'Inbound.gs' });
  env.g = sandbox;
  env.post = body => JSON.parse(sandbox.doPost({ postData: { contents: JSON.stringify(body) } }).s);
  env.session = email => sandbox.makeSession_(email);
  return env;
}
module.exports = { makeEnv };
