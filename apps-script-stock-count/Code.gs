/**
 * Stock Count (ការរាប់ស្តុក) — Google Apps Script backend for isteel-app.pages.dev/stock-count/.
 * Digital stock card per bin: one bin = one SKU. Replaces the paper stock card for cycle counts.
 *
 * Bound to the "SSK-STOCK-COUNT" Google Sheet (Extensions > Apps Script inside that sheet). Tabs:
 *   Bin Master  one row per bin: Bin, Warehouse, SKU, Description, UoM, Pcs per Bundle, Book Qty, Active (+ last count, filled by the app)
 *   Stock Ledger  one row per posted movement (In, Out, Transfer); the digital stock card. Never edited by the app.
 *   Counts      one row per counted or issued SKU line (the history / digital stock card), written by header name.
 *   Who may count: the Users tab of the Fuel Refill sheet (USERS_SHEET_ID), tick box ការរាប់ស្តុក.
 *   Settings    TOLERANCE_PCS, DAILY_LIST_SIZE, ACCURACY_WINDOW
 * Drive folder "Stock Count Photos": one photo per count with a difference (SHORT or OVER).
 *
 * Script Properties (Project Settings > Script properties):
 *   GOOGLE_CLIENT_ID   same Client ID as the other iSteel apps (web/config.js)
 *   SESSION_SECRET     copy of the Fuel app's SESSION_SECRET, so one sign-in works in every app
 *   USERS_SHEET_ID     id of the Fuel Refill sheet (same as Inbound)
 *   SC_FOLDER_ID       made by setup(); Drive folder "Stock Count Photos"
 * Pure rules (countedPcs, countedQty, statusOf, validateCount, accuracyPct, todayList) live in rules.gs.
 */

const SH = { BIN: 'Bin Master', STK: 'Stock On Hand', CNT: 'Counts', SET: 'Settings', LED: 'Stock Ledger', PM: 'Product Master', VAR: 'Variance Log', VSN: 'Variance Snapshots', GI: 'GI Reconciliation' };
// Product Master = pipe materials with pieces per bundle and kg per piece (from Kim's Product Master file). It turns a count in
// bundles / pieces into kg. Filled once from ProductMaster.gs when the tab is empty; after that the tab is edited by hand.
const PM_COLS = ['Material', 'Description', 'Pipe Size', 'Pcs per Bundle', 'Kg per Pc', 'Source'];
// Stock Ledger = the digital stock card: one row per posted movement (In, Out, Transfer Out, Transfer In). Rows are never edited
// or deleted by the app; a correction is a new movement. Book Qty in Stock On Hand is the running balance of each line.
const LED_COLS = ['Txn ID', 'Date', 'Time', 'Type', 'Bin', 'Material', 'Description', 'Batch', 'SLOC', 'UoM', 'In', 'Out', 'Balance',
  'Reference', 'Other Bin', 'Transfer ID', 'Remark', 'User', 'Request ID', 'Reverses'];
// Bin Master = bin master data only (bin, warehouse, active). Stock On Hand = what is in each bin (from MB52): book qty per SKU, batch and SLOC.
const BIN_COLS = ['Bin', 'Warehouse', 'Active', 'Last Count', 'Last Status'];
const STK_COLS = ['Bin', 'Material', 'Description', 'Batch', 'SLOC', 'UoM', 'Pcs per Bundle', 'Book Qty',
  'Counted Qty Bundle', 'Counted Qty Kg', 'Counted Qty Pcs', 'Total Counted Qty Kg', 'Difference', 'Count Date', 'Count Time'];
// Counts tab as Kim set it on 13 Nov. Rows are written by header name (appendCount_), so columns can be moved,
// renamed back to the old names, or added (Out Qty, Counted Qty, Diff, Status, Photo, Note) without changing the code.
const CNT_COLS = ['Count ID', 'Type', 'Date', 'Time', 'Bin', 'SKU', 'Description', 'Batch No', 'Sloc', 'On Hand', 'OH UoM',
  'Counted Qty Bundle', 'Counted Qty Kg', 'Counted Qty Pcs', 'Remark', 'Counted By'];
const SET_COLS = ['Setting', 'Value', 'Note'];
const SET_SEED = [
  ['TOLERANCE_PCS', '0', 'Difference allowed without a photo (pcs). 0 = must match exactly.'],
  ['DAILY_LIST_SIZE', '20', 'Bins shown in Today\'s count list'],
  ['ACCURACY_WINDOW', '10', 'Last N counts per bin used for the accuracy score'],
];
const MAX_PHOTO_BYTES = 4 * 1024 * 1024;
const TZ = 'Asia/Phnom_Penh';

// ---------------------------------------------------------------- web entry points
function doGet() { return json_({ ok: true, app: 'Stock Count' }); }

function doPost(e) {
  let body = {};
  try { body = JSON.parse((e && e.postData && e.postData.contents) || '{}'); } catch (err) { return json_({ ok: false, error: 'BAD: Bad request' }); }
  try {
    if (body.action === 'pmSync') return json_({ ok: true, data: pmSync_(body) });   // Kim's PC pushes the Excel Product Master (key, no sign-in)
    const user = authenticate_(body.token);
    const out = { ok: true, data: route_(body.action, body.payload || {}, user) };
    if (user.session) out.session = user.session;
    return json_(out);
  } catch (err) {
    const msg = String(err && err.message || err);
    if (!/^[A-Z_]+:/.test(msg)) console.error(body.action + ' failed: ' + (err && err.stack || msg));
    return json_({ ok: false, error: /^[A-Z_]+:/.test(msg) ? msg : 'SERVER: ' + msg });
  }
}

function route_(action, p, user) {
  switch (action) {
    case 'boot': return boot_(user);
    case 'bin': return binInfo_(user, p.bin);
    case 'submit': return withLock_(() => submit_(user, p.count || {}));
    case 'out': return withLock_(() => out_(user, p.out || {}));
    case 'ledger': return ledger_(user);
    case 'move': return withLock_(() => move_(user, p));
    case 'transfer': return withLock_(() => transfer_(user, p));
    case 'card': return card_(user, p);
    case 'editLine': return withLock_(() => editLine_(user, p));
    case 'products': return productTable_(user);
    case 'varSave': return withLock_(() => varSave_(user, p));
    case 'varList': return varList_(user);
    case 'varUpdate': return withLock_(() => varUpdate_(user, p));
    case 'reverse': return withLock_(() => reverse_(user, p));
    case 'giConfirm': return withLock_(() => giConfirm_(user, p));
    case 'giList': return giList_(user);
    default: fail_('BAD', 'Unknown action');
  }
}

function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
function fail_(code, en, kh) { throw new Error(code + ': ' + en + (kh ? ' || ' + kh : '')); }
const prop_ = k => PropertiesService.getScriptProperties().getProperty(k) || '';
const fmt_ = (d, f) => Utilities.formatDate(d, TZ, f);
const yes_ = v => /^(yes|y|true|1|✓)$/i.test(String(v == null ? '' : v).trim());
const clip_ = (v, n) => String(v == null ? '' : v).trim().slice(0, n || 200);
const ss_ = () => SpreadsheetApp.getActive();

function withLock_(fn) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(28000)) fail_('BUSY', 'Many people are saving at once. Please try again.', 'មានអ្នករក្សាទុកច្រើនពេក។ សូមព្យាយាមម្តងទៀត។');
  try { return fn(); } finally { lock.releaseLock(); }
}

// ---- One master file for every app (Kim, 23 Nov 2026): Google Sheet "Master Data - All - For Apps" ----
const MD_SHEET_DEFAULT = '1AtbdmWOJbYbiXD4vbpz6h5W3G2WWiek_grt1FeQ8hEc';   // Script property MASTER_SHEET_ID wins
let MD_BOOK_ = null;
/** A tab of the master file, or null when it can't be opened (then the app falls back to its old tab). */
function mdTab_(name) {
  try {
    if (!MD_BOOK_) MD_BOOK_ = SpreadsheetApp.openById(PropertiesService.getScriptProperties().getProperty('MASTER_SHEET_ID') || MD_SHEET_DEFAULT);
    return MD_BOOK_.getSheetByName(name);
  } catch (e) { console.warn('Master Data file: ' + e); return null; }
}
/** Old tab name -> tab in the master file. */
const MD_MAP_ = { 'Bin Master': 'Bin', 'Product Master': 'Product' };
function mdOf_(name) { return MD_MAP_[name] ? mdTab_(MD_MAP_[name]) : null; }

function sheet_(name, cols, seed) {
  const ss = ss_();
  let sh = mdOf_(name) || ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, cols.length).setValues([cols]).setFontWeight('bold').setBackground('#011e41').setFontColor('#ffffff');
    sh.setFrozenRows(1);
    sh.getRange(1, 1, sh.getMaxRows(), cols.length).setNumberFormat('@');   // plain text: bin codes stay as typed
    if (seed && seed.length) sh.getRange(2, 1, seed.length, cols.length).setValues(seed);
  }
  return sh;
}
function objs_(name, cols) {
  const sh = sheet_(name, cols);
  if (sh.getLastRow() < 2) return [];
  const v = sh.getRange(1, 1, sh.getLastRow(), sh.getLastColumn()).getDisplayValues();
  const head = v[0].map(h => String(h).trim());
  return v.slice(1).map(r => { const o = {}; head.forEach((h, i) => { o[h] = String(r[i] == null ? '' : r[i]).trim(); }); return o; });
}

// ---------------------------------------------------------------- setup (run once from the editor)
/** Adds the tabs and the Drive folder. Safe to run again. */
function setup() {
  sheet_(SH.BIN, BIN_COLS);
  sheet_(SH.STK, STK_COLS);
  sheet_(SH.CNT, CNT_COLS);
  sheet_(SH.SET, SET_COLS, SET_SEED);
  sheet_(SH.LED, LED_COLS);
  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty('SC_FOLDER_ID')) props.setProperty('SC_FOLDER_ID', DriveApp.createFolder('Stock Count Photos').getId());
  const first = ss_().getSheets()[0];
  if (first && !Object.values(SH).includes(first.getName()) && first.getLastRow() === 0) ss_().deleteSheet(first);
  const notes = [];
  ['GOOGLE_CLIENT_ID', 'SESSION_SECRET', 'USERS_SHEET_ID'].forEach(k => { if (!prop_(k)) notes.push('Add ' + k + ' in Script properties.'); });
  notes.push('Tick ' + APP_COL + ' for each counter in the Users tab (Fuel Refill sheet).');
  notes.push('Then: Deploy > New deployment > Web app, Execute as Me, Who has access Anyone.');
  const msg = notes.join('\n');
  console.log(msg);
  return msg;
}

/** Run once from the editor to allow saving photos to Drive. */
function authorize() {
  const f = DriveApp.createFolder('permission check');
  f.setTrashed(true);
  Logger.log('OK');
}

// ---------------------------------------------------------------- sign-in (same sessions as the other iSteel apps)
const SESSION_DAYS = 30, SESSION_RENEW_DAYS = 15;
const b64url_ = data => Utilities.base64EncodeWebSafe(data).replace(/=+$/, '');
const b64urlText_ = s => Utilities.newBlob(Utilities.base64DecodeWebSafe(s + '==='.slice((s.length + 3) % 4))).getDataAsString();
const SESSION_HEAD = () => b64url_(JSON.stringify({ alg: 'HS256', typ: 'STEEL' }));
const sessionSig_ = t => b64url_(Utilities.computeHmacSha256Signature(t, prop_('SESSION_SECRET')));
const AUTH_MSG = ['Sign-in expired. Please sign in again.', 'ការចូលបានផុតកំណត់។ សូមចូលម្តងទៀត។'];

function makeSession_(email) {
  if (!prop_('SESSION_SECRET')) return null;
  const now = Math.floor(Date.now() / 1000);
  const body = b64url_(Utilities.newBlob(JSON.stringify({ email: email, iat: now, exp: now + SESSION_DAYS * 86400 })).getBytes());
  return SESSION_HEAD() + '.' + body + '.' + sessionSig_(SESSION_HEAD() + '.' + body);
}
function readSession_(token) {
  const parts = String(token).split('.');
  if (parts.length !== 3 || parts[0] !== SESSION_HEAD() || !prop_('SESSION_SECRET')) return null;
  if (sessionSig_(parts[0] + '.' + parts[1]) !== parts[2]) fail_('AUTH', AUTH_MSG[0], AUTH_MSG[1]);
  const b = JSON.parse(b64urlText_(parts[1]));
  if (!(b.exp * 1000 > Date.now())) fail_('AUTH', AUTH_MSG[0], AUTH_MSG[1]);
  return { email: String(b.email).toLowerCase(), exp: b.exp };
}
function verifyGoogle_(token) {
  const cache = CacheService.getScriptCache();
  const key = 'tok_' + b64url_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, token));
  const hit = cache.get(key);
  if (hit) return hit;
  const res = UrlFetchApp.fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(token), { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) fail_('AUTH', AUTH_MSG[0], AUTH_MSG[1]);
  const info = JSON.parse(res.getContentText());
  if (!prop_('GOOGLE_CLIENT_ID') || info.aud !== prop_('GOOGLE_CLIENT_ID')) fail_('AUTH', 'Sign-in is not set up for this app.', 'ការចូលមិនទាន់រៀបចំសម្រាប់កម្មវិធីនេះ។');
  if (String(info.email_verified) !== 'true') fail_('AUTH', 'Google email is not verified.');
  const email = String(info.email).toLowerCase();
  const left = Number(info.exp) - Math.floor(Date.now() / 1000);
  if (left > 60) cache.put(key, email, Math.min(left - 30, 3000));
  return email;
}

function authenticate_(token) {
  if (!token) fail_('AUTH', 'Please sign in.', 'សូមចូលគណនី។');
  let email, session = null;
  const own = readSession_(token);
  if (own) {
    email = own.email;
    if (own.exp - Math.floor(Date.now() / 1000) < SESSION_RENEW_DAYS * 86400) session = makeSession_(email);
  } else {
    email = verifyGoogle_(token);
    session = makeSession_(email);
  }
  return { email: email, session: session };
}

// Access = the one user list: the Users tab of the Fuel Refill sheet (USERS_SHEET_ID), same as Inbound.
// Active = Yes and the ការរាប់ស្តុក tick box ticked (admins always). Admin role = Role contains "admin".
const APP_COL = 'ការរាប់ស្តុក';
// The person's name for sheet rows (Kim, 14 Nov: no emails on screen); the part before @ when Users has no name.
const name_ = (who, user) => (who && who.Name && who.Name.indexOf('@') < 0 ? who.Name : String(user.email).split('@')[0]);

function counter_(user) {
  const cache = CacheService.getScriptCache(), ck = 'who_' + user.email;
  const hit = cache.get(ck);
  if (hit) return JSON.parse(hit);
  const who = counterLookup_(user);
  cache.put(ck, JSON.stringify(who), 600);   // 10 min: a new tick in Users shows within 10 minutes
  return who;
}
function counterLookup_(user) {
  const id = prop_('USERS_SHEET_ID');
  if (!id) fail_('SETUP', 'USERS_SHEET_ID is missing in Script properties.');
  const sh = SpreadsheetApp.openById(id).getSheetByName('Users');
  const v = sh && sh.getLastRow() > 1 ? sh.getRange(1, 1, sh.getLastRow(), sh.getLastColumn()).getValues() : [[]];
  const head = v[0].map(h => String(h).trim());
  const c = n => head.indexOf(n);
  const e = c('Email'), n = c('Name'), r = c('Role'), a = c('Active'), tick = c(APP_COL), cat = c('Stock Categories');
  const row = v.slice(1).find(x => e >= 0 && String(x[e]).trim().toLowerCase() === user.email);
  const admin = !!row && r >= 0 && /admin/i.test(String(row[r]));
  const ok = !!row && (a < 0 || yes_(row[a])) && (admin || (tick >= 0 && yes_(row[tick])));
  if (!ok) fail_('NOACCESS', 'Your account is not allowed to count yet. Ask Kim to tick ' + APP_COL + ' in Users.',
    'គណនីរបស់អ្នកមិនទាន់មានសិទ្ធិរាប់ស្តុកទេ។ សូមស្នើអ្នកគ្រប់គ្រងធីក ' + APP_COL + ' ក្នុង Users។');
  const role = r >= 0 ? String(row[r]).trim() : '';
  // Stock access (Kim, 27 Nov 2026): "Stock Categories" = Material Group L4 names this person may see; blank = all.
  const cats = cat >= 0 ? String(row[cat] || '').split(',').map(x => x.trim()).filter(Boolean) : [];
  return { Name: n >= 0 ? String(row[n]).trim() : user.email, admin: admin, role: role, supervisor: /supervisor/i.test(role), cats: cats };
}
// null = sees everything; else material → true when its Product Master group (L4) is one of the person's categories.
function seeFn_(who) {
  if (!who || !who.cats || !who.cats.length) return null;
  const set = {}, pm = pm_();
  who.cats.forEach(x => { set[String(x).trim().toLowerCase()] = 1; });
  return mat => !!set[String((pm[String(mat || '').trim().toUpperCase()] || {}).group || '').trim().toLowerCase()];
}

// ---------------------------------------------------------------- data
function settings_() {
  const m = {};
  objs_(SH.SET, SET_COLS).forEach(r => { m[r.Setting] = r.Value; });
  return { tol: Number(m.TOLERANCE_PCS) || 0, listSize: Number(m.DAILY_LIST_SIZE) || 20, win: Number(m.ACCURACY_WINDOW) || 10 };
}

// Bin Master is the storage-bin master list: the bin code is the "STORAGE BIN" column (or "Bin"), Warehouse and Active.
const binHead_ = h => ({ code: h.indexOf('STORAGE BIN') >= 0 ? h.indexOf('STORAGE BIN') : h.indexOf('Bin'), wh: h.indexOf('Warehouse'), active: h.indexOf('Active'),
  last: h.indexOf('Last Count'), status: h.indexOf('Last Status') });
function binRows_() {
  const sh = sheet_(SH.BIN, BIN_COLS);
  if (sh.getLastRow() < 2) return { sh: sh, head: [], rows: [] };
  const v = sh.getRange(1, 1, sh.getLastRow(), sh.getLastColumn()).getDisplayValues();
  return { sh: sh, head: v[0].map(h => String(h).trim()), rows: v.slice(1) };
}
function bins_() {
  const d = binRows_(), c = binHead_(d.head);
  if (c.code < 0) return [];
  return d.rows.filter(r => String(r[c.code]).trim() && (c.active < 0 || yes_(r[c.active]))).map(r => ({
    bin: String(r[c.code]).trim(), warehouse: c.wh >= 0 ? String(r[c.wh]).trim() : '',
    lastCount: c.last >= 0 ? String(r[c.last]).trim() : '', lastStatus: c.status >= 0 ? String(r[c.status]).trim() : '', active: true }));
}

// Stock lines of one bin (or all, when bin is empty). Each line is one material + batch + SLOC.
function stock_(bin) {
  const pm = pm_();
  return objs_(SH.STK, STK_COLS).filter(r => r.Bin && (!bin || r.Bin.toUpperCase() === bin.toUpperCase())).map(r => {
    const m = pm[String(r.Material).toUpperCase()] || {};
    // Pcs per Bundle typed in Stock On Hand wins; blank (or 1 on a pipe) falls back to the Product Master.
    const typed = num_(r['Pcs per Bundle']);
    return { bin: r.Bin, material: r.Material, desc: r.Description, batch: r.Batch, sloc: r.SLOC, uom: r.UoM || 'PC',
      pcsPerBundle: (typed > 1 ? typed : m.ppb) || typed || 1, kgPerPc: m.kg || 0, book: num_(r['Book Qty']),
      group: m.group || '', countDate: [r['Count Date'] || '', r['Count Time'] || ''].join(' ').trim(),
      // Counted Qty column (new) or, for counts before it, book + Difference; blank when never counted.
      counted: r['Counted Qty'] !== undefined && r['Counted Qty'] !== '' ? num_(r['Counted Qty']) : (r.Difference !== undefined && r.Difference !== '' && r['Count Date'] ? num_(r['Book Qty']) + num_(r.Difference) : ''),
      diff: r.Difference !== undefined && r.Difference !== '' ? num_(r.Difference) : '', countedBy: r['Counted By'] || '' };
  });
}
// Product Master list, kept 10 minutes. An empty tab is filled from PM_SEED (ProductMaster.gs) first.
// Columns are found by name, so Kim's own headers work: "PC/Bundle" or "Pcs per Bundle", "Kg/PC" or "Kg per Pc",
// and an optional "UoM" / "SAP UoM" / "Base UoM" (the unit SAP books the material in).
function pmList_() {
  const cache = CacheService.getScriptCache();
  const hit = cache.get('pml');
  if (hit) { try { return JSON.parse(hit); } catch (e) { /* read again */ } }
  const sh = sheet_(SH.PM, PM_COLS);
  if (sh.getLastRow() < 2 && typeof PM_SEED !== 'undefined' && PM_SEED.length) {
    sh.getRange(1, 1, 1, PM_COLS.length).setValues([PM_COLS]);
    sh.getRange(2, 1, PM_SEED.length, PM_COLS.length).setNumberFormat('@').setValues(PM_SEED.map(r => r.map(String)));
  }
  const norm = h => String(h).toLowerCase().replace(/[^a-z0-9]/g, '');
  const get = (r, names) => { for (const k in r) if (names.indexOf(norm(k)) >= 0 && r[k] !== '') return r[k]; return ''; };
  const out = objs_(SH.PM, PM_COLS).filter(r => get(r, ['material', 'materialcode', 'sku'])).map(r => ({
    material: get(r, ['material', 'materialcode', 'sku']), desc: get(r, ['description', 'materialdescription']),
    group: get(r, ['materialgroupl4', 'group']), size: get(r, ['size', 'pipesize']),
    ppb: num_(get(r, ['pcbundle', 'pcsbundle', 'pcsperbundle', 'pcperbundle'])), kg: num_(get(r, ['kgpc', 'kgperpc', 'kgpcs', 'kgperpcs'])),
    uom: String(get(r, ['uom', 'sapuom', 'baseuom', 'unit'])).toUpperCase() }));
  try { cache.put('pml', JSON.stringify(out), 600); } catch (e) { /* too big for the cache: read each time */ }
  return out;
}
// Product Master from Kim's Excel (Kim, 20 Nov 2026): OneDrive ...\Product Master (in use), sheet "Product Master".
// A task on Kim's PC (tools/product-master-sync) posts the rows here with the PM_SYNC_KEY script property.
// The tab is replaced by the Excel rows. Kg/PC and UoM are not in the Excel yet, so the values already typed in the
// tab are kept for the same material (an Excel column named Kg/PC or UoM wins when it is there).
function pmSync_(body) {
  const key = prop_('PM_SYNC_KEY');
  if (!key || String(body.key || '') !== key) fail_('AUTH', 'Wrong sync key.');
  const rows = Array.isArray(body.rows) ? body.rows : [];
  if (rows.length < 10) fail_('BAD', 'Too few Product Master rows (' + rows.length + '); nothing changed.');
  const norm = h => String(h).toLowerCase().replace(/[^a-z0-9]/g, '');
  const pick = (r, names) => { for (const k in r) if (names.indexOf(norm(k)) >= 0 && r[k] !== '' && r[k] != null) return String(r[k]).trim(); return ''; };
  const old = {};
  objs_(SH.PM, PM_COLS).forEach(r => {
    const m = pick(r, ['material', 'materialcode', 'sku']).toUpperCase();
    if (m) old[m] = { kg: pick(r, ['kgpc', 'kgperpc', 'kgpcs', 'kgperpcs']), uom: pick(r, ['uom', 'sapuom', 'baseuom', 'unit']) };
  });
  // Main columns first (names the app reads), then every other Excel column in Excel order (Kim, 20 Nov: Product menu shows them all).
  const MAIN = [['Material', ['materialcode', 'material', 'sku']], ['Description', ['materialdescription', 'description']],
    ['Material Group L1', ['materialgroupl1']], ['Material Group L2', ['materialgroupl2']], ['Material Group L3', ['materialgroupl3']],
    ['Material Group L4', ['materialgroupl4', 'group']], ['ABC Class', ['class', 'abcclass']], ['Size', ['size', 'pipesize']], ['Grade', ['grade']],
    ['Brand', ['brand']], ['UoM', ['uom', 'baseuom', 'uomsap', 'sapuom']], ['PC/Bundle', ['pcsbundle', 'pcbundle', 'pcsperbundle']], ['Kg/PC', ['kgpc', 'kgperpc', 'weightpc']]];
  const used = {};
  MAIN.forEach(c => c[1].forEach(n => { used[n] = 1; }));
  const xhead = (Array.isArray(body.head) && body.head.length ? body.head : Object.keys(rows[0] || {})).map(h => String(h || '').trim())
    .filter((h, i, a) => h && !used[norm(h)] && norm(h) !== 'source' && a.indexOf(h) === i);
  const head = MAIN.map(c => c[0]).concat(xhead, ['Source']);
  const seen = {};
  const out = [];
  rows.forEach(r => {
    const m = pick(r, MAIN[0][1]);
    if (!m || seen[m.toUpperCase()]) return;
    seen[m.toUpperCase()] = 1;
    const o = old[m.toUpperCase()] || {};
    const main = MAIN.map(c => pick(r, c[1]));
    main[10] = (main[10] || o.uom || '').toUpperCase();
    main[12] = main[12] || o.kg || '';
    out.push(main.concat(xhead.map(h => (r[h] == null ? '' : String(r[h]).trim())), ['Excel ' + String(body.file || '').slice(0, 80)]));
  });
  const sh = sheet_(SH.PM, PM_COLS);
  const lastRow = sh.getLastRow(), lastCol = Math.max(sh.getLastColumn(), head.length);
  if (lastRow > 0) sh.getRange(1, 1, lastRow, lastCol).clearContent();
  sh.getRange(1, 1, out.length + 1, head.length).setNumberFormat('@').setValues([head].concat(out));
  try { CacheService.getScriptCache().remove('pml'); } catch (e) { /* cache gone already */ }
  const now = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm');
  return { rows: out.length, at: now };
}
// Product menu (Kim, 20 Nov 2026): the whole Product Master tab, for admins and supervisors (Users Role contains "Supervisor").
function productTable_(user) {
  const who = counter_(user);
  if (!who.admin && !/supervisor/i.test(String(who.role || ''))) fail_('NOACCESS', 'Only admins and supervisors can see the Product list.', 'មានតែអ្នកគ្រប់គ្រង និងប្រធានក្រុមទេ ដែលអាចមើលបញ្ជីផលិតផល។');
  const sh = sheet_(SH.PM, PM_COLS);
  if (sh.getLastRow() < 1) return { head: [], rows: [] };
  const v = sh.getRange(1, 1, sh.getLastRow(), sh.getLastColumn()).getDisplayValues();
  const head = v[0].map(h => String(h).trim());
  const keep = head.map((h, i) => i).filter(i => head[i]);
  return { head: keep.map(i => head[i]), rows: v.slice(1).filter(r => r.some(x => x !== '')).map(r => keep.map(i => r[i])) };
}
// ---------------------------------------------------------------- SAP variance log (Kim, 27 Nov 2026)
// SAP check "Save variance": one row per variance case (material + batch [+ bin, SLOC]) in Variance Log, kept open until it is
// resolved by hand or the next saved SAP file matches. Variance Snapshots = one row per saved SAP file (match rate history).
const VAR_COLS = ['Case ID', 'First Seen', 'Last Seen', 'Times', 'Key', 'Bin', 'Material', 'Batch', 'SLOC', 'Description', 'UoM',
  'Digital', 'SAP', 'Variance', 'Result', 'Reason', 'Remark', 'Owner', 'Status', 'Action', 'Resolved At', 'Updated By', 'Last Snapshot'];
const VSN_COLS = ['Snapshot ID', 'Saved At', 'File', 'Snapshot', 'Compared By', 'Lines', 'Match', 'Variances', 'Saved By'];
const VAR_STATUS = ['Open', 'Investigating', 'Resolved'];
const isResolved_ = s => /^resolved/i.test(String(s || ''));
// Writes objects back to a tab by header name (columns Kim adds or moves stay where they are).
function writeObjs_(name, cols, list) {
  const sh = sheet_(name, cols);
  let head = sh.getLastColumn() ? sh.getRange(1, 1, 1, sh.getLastColumn()).getDisplayValues()[0].map(h => String(h).trim()) : [];
  const miss = cols.filter(c => head.indexOf(c) < 0);
  if (miss.length) { sh.getRange(1, head.length + 1, 1, miss.length).setValues([miss]).setFontWeight('bold'); head = head.concat(miss); }
  const last = sh.getLastRow();
  if (last > 1) sh.getRange(2, 1, last - 1, head.length).clearContent();
  if (list.length) sh.getRange(2, 1, list.length, head.length).setNumberFormat('@').setValues(list.map(o => head.map(h => (o[h] == null ? '' : String(o[h])))));
}
function varSave_(user, p) {
  const who = counter_(user), by = name_(who, user);
  const file = clip_(p.file, 120), snap = clip_(p.at, 40), level = clip_(p.level, 60);
  if (!file || !snap) fail_('BAD', 'Load a SAP file first.', 'សូមនាំចូលឯកសារ SAP ជាមុនសិន។');
  const rows = Array.isArray(p.rows) ? p.rows.slice(0, 5000) : [];
  const matched = {}; (Array.isArray(p.matched) ? p.matched : []).forEach(k => { matched[level + ':' + String(k).toUpperCase()] = 1; });
  let h = 0; String(file + '|' + snap).split('').forEach(ch => { h = (h * 31 + ch.charCodeAt(0)) >>> 0; });
  const sid = 'VS-' + h.toString(36).toUpperCase();
  const now = fmt_(new Date(), 'yyyy-MM-dd HH:mm');
  const snaps = objs_(SH.VSN, VSN_COLS);
  const s0 = snaps.find(s => s['Snapshot ID'] === sid);
  const srow = { 'Snapshot ID': sid, 'Saved At': now, File: file, Snapshot: snap, 'Compared By': level, Lines: String(num_(p.lines)), Match: String(num_(p.match)), Variances: String(rows.length), 'Saved By': by };
  if (s0) Object.assign(s0, srow); else snaps.push(srow);
  const cases = objs_(SH.VAR, VAR_COLS);
  const open = {}; cases.forEach(c => { if (!isResolved_(c.Status)) open[c.Key] = c; });
  let seq = cases.filter(c => String(c['Case ID']).indexOf('VC-' + fmt_(new Date(), 'yyMMdd')) === 0).length;
  let added = 0, updated = 0, closed = 0;
  rows.forEach(r => {
    const key = level + ':' + String(r.key || '').toUpperCase();
    const vals = { Bin: clip_(r.bin, 40), Material: clip_(r.material, 40), Batch: clip_(r.batch, 40), SLOC: clip_(r.sloc, 20), Description: clip_(r.desc, 120), UoM: clip_(r.uom, 10),
      Digital: r.digital == null ? '' : String(num_(r.digital)), SAP: r.sap == null ? '' : String(num_(r.sap)), Variance: String(num_(r.variance)), Result: clip_(r.status, 20), 'Last Seen': snap };
    if (r.reason != null && String(r.reason).trim()) vals.Reason = clip_(r.reason, 60);
    if (r.remark != null && String(r.remark).trim()) vals.Remark = clip_(r.remark, 300);
    let c = open[key];
    if (c) {
      if (c['Last Snapshot'] !== sid) c.Times = String((num_(c.Times) || 1) + 1);
      Object.assign(c, vals, { 'Last Snapshot': sid, 'Updated By': by }); updated++;
    } else {
      seq++;
      c = Object.assign({ 'Case ID': 'VC-' + fmt_(new Date(), 'yyMMdd') + '-' + ('00' + seq).slice(-3), 'First Seen': snap, Times: '1', Key: key, Reason: '', Remark: '', Owner: '',
        Status: 'Open', Action: '', 'Resolved At': '' }, vals, { 'Last Snapshot': sid, 'Updated By': by });
      cases.push(c); open[key] = c; added++;
    }
  });
  // An open case that matches in this SAP file is closed by itself.
  cases.forEach(c => { if (!isResolved_(c.Status) && matched[c.Key]) { c.Status = 'Resolved'; c.Action = c.Action || 'Matched in SAP'; c['Resolved At'] = now; c['Updated By'] = by; closed++; } });
  writeObjs_(SH.VSN, VSN_COLS, snaps);
  writeObjs_(SH.VAR, VAR_COLS, cases);
  return { snapshot: sid, added: added, updated: updated, closed: closed };
}
function varList_(user) {
  const see = seeFn_(counter_(user));
  return { cases: objs_(SH.VAR, VAR_COLS).filter(r => !see || see(r.Material)).slice(-3000), snaps: objs_(SH.VSN, VSN_COLS).slice(-60) };
}
function varUpdate_(user, p) {
  const who = counter_(user);
  const cases = objs_(SH.VAR, VAR_COLS);
  const c = cases.find(x => x['Case ID'] === String(p.id || ''));
  if (!c) fail_('BAD', 'This variance is not in the log.', 'រកមិនឃើញក្នុងបញ្ជីខុសគ្នា។');
  ['Reason', 'Remark', 'Owner', 'Action'].forEach(k => { const v = p[k.toLowerCase()]; if (v != null) c[k] = clip_(v, k === 'Remark' ? 300 : 60); });
  if (p.status != null) {
    const s = VAR_STATUS.find(x => x.toLowerCase() === String(p.status).toLowerCase());
    if (!s) fail_('BAD', 'Unknown status.');
    if (s === 'Resolved' && !c.Action) fail_('BAD', 'Choose the action before you resolve it.', 'សូមជ្រើសសកម្មភាព មុនបិទ។');
    c['Resolved At'] = s === 'Resolved' ? (isResolved_(c.Status) ? c['Resolved At'] : fmt_(new Date(), 'yyyy-MM-dd HH:mm')) : '';
    c.Status = s;
  }
  c['Updated By'] = name_(who, user);
  writeObjs_(SH.VAR, VAR_COLS, cases);
  return { case: c };
}
// Product Master as { MATERIAL: { ppb, kg, desc, uom } }.
function pm_() {
  const out = {};
  pmList_().forEach(p => { out[p.material.toUpperCase()] = p; });
  return out;
}
// Sheet text to number: '4,620.00' -> 4620, blank -> 0.
const num_ = v => Number(String(v == null ? '' : v).replace(/,/g, '')) || 0;
const lineKey_ = l => [l.bin || '', l.material, l.batch, l.sloc].join('|').toUpperCase();

// Status history per bin, in the order it was saved (counts only).
function history_() {
  const h = {};
  objs_(SH.CNT, CNT_COLS).filter(r => r.Type === 'Count' && r.Status).forEach(r => { (h[r.Bin] = h[r.Bin] || []).push(r.Status); });
  return h;
}

function boot_(user) {
  const who = counter_(user);
  const st = settings_();
  const hist = history_();
  const see = seeFn_(who);
  const stock = stock_('').filter(l => !see || see(l.material)), per = {};
  stock.forEach(l => { per[l.bin.toUpperCase()] = (per[l.bin.toUpperCase()] || 0) + 1; });
  const list = bins_().map(b => Object.assign({}, b, { accuracy: accuracyPct(hist[b.bin] || [], st.win), lines: per[b.bin.toUpperCase()] || 0 }));
  return { user: { email: user.email, name: who.Name || user.email, admin: !!who.admin, supervisor: /supervisor/i.test(String(who.role || '')), cats: who.cats || [] }, settings: { tolerance: st.tol },
    today: todayList(list, st.listSize), bins: list, stock: stock, products: pmList_().filter(x => !see || see(x.material)), binCount: list.length, dash: dash_(stock.length, list.length, see) };
}

// Home numbers: bins, stock lines, movements posted today, and the last 10 movements.
function dash_(lines, bins, see) {
  const today = fmt_(new Date(), 'yyyy-MM-dd');
  const led = objs_(SH.LED, LED_COLS).filter(r => !see || see(r.Material));
  const t = led.filter(r => r.Date === today);
  return { bins: bins, lines: lines, inToday: t.filter(r => r.Type === 'IN').length, outToday: t.filter(r => r.Type === 'OUT').length,
    transferToday: t.filter(r => r.Type === 'TRANSFER OUT').length, recent: led.slice(-10).reverse().map(ledRow_) };
}
const ledRow_ = r => ({ id: r['Txn ID'], date: r.Date, time: r.Time, type: r.Type, bin: r.Bin, material: r.Material, desc: r.Description, batch: r.Batch,
  sloc: r.SLOC, uom: r.UoM, qtyIn: num_(r.In), qtyOut: num_(r.Out), balance: num_(r.Balance), reference: r.Reference, otherBin: r['Other Bin'], remark: r.Remark, user: r.User, reverses: r.Reverses || '', tid: r['Transfer ID'] || '' });

// Movements screen: the newest 1,000 ledger rows, oldest first.
function ledger_(user) {
  const see = seeFn_(counter_(user));
  return { rows: objs_(SH.LED, LED_COLS).filter(r => !see || see(r.Material)).slice(-1000).map(ledRow_) };
}

function binInfo_(user, code) {
  const see = seeFn_(counter_(user));
  const st = settings_();
  const bin = String(code || '').trim();
  const b = bins_().find(x => x.bin.toUpperCase() === bin.toUpperCase());
  if (!b) fail_('NOBIN', 'Bin not found or not active in Bin Master.', 'រកមិនឃើញទីតាំងនេះក្នុងបញ្ជីទេ។');
  const hist = history_();
  return { bin: b.bin, warehouse: b.warehouse, lastCount: b.lastCount, lastStatus: b.lastStatus,
    accuracy: accuracyPct(hist[b.bin] || [], st.win), lines: stock_(b.bin).filter(l => !see || see(l.material)) };
}

// ---------------------------------------------------------------- save a count (all SKU lines of a bin, one submit)
function submit_(user, c) {
  const who = counter_(user);
  const st = settings_();
  const bin = String(c.bin || '').trim();
  const b = bins_().find(x => x.bin.toUpperCase() === bin.toUpperCase());
  if (!b) fail_('NOBIN', 'Bin not found or not active in Bin Master.', 'រកមិនឃើញទីតាំងនេះក្នុងបញ្ជីទេ។');
  const stock = stock_(b.bin);
  const lines = Array.isArray(c.lines) ? c.lines : [];
  if (!lines.length) fail_('BAD', 'Nothing to count.');
  const rows = [];
  let worst = 'MATCH';
  lines.forEach(l => {
    const bad = validateCount(l);
    if (bad) fail_('BAD', bad);
    const s = stock.find(x => lineKey_(Object.assign({ bin: b.bin }, x)) === lineKey_(Object.assign({ bin: b.bin }, l)));
    if (!s) fail_('NOLINE', 'Material ' + l.material + ' is not in this bin.');
    // Any one of Bundle / Kg / Pcs is enough. The book is compared and changed only when the box in the book unit is filled.
    // Damaged part of the count (Kim, 27 Nov, point 7): already included in Bundle / Kg / Pcs; saved apart as Damaged Qty + Damage Type.
    const dm = l.damaged && typeof l.damaged === 'object' ? { bundles: l.damaged.bundles == null ? '' : String(l.damaged.bundles), kg: l.damaged.kg == null ? '' : String(l.damaged.kg), pieces: l.damaged.pieces == null ? '' : String(l.damaged.pieces) } : null;
    const dmg = dm && !(dm.bundles === '' && dm.kg === '' && dm.pieces === '') ? { qty: comparable(dm, s.uom) ? countedQty(dm, s.uom, s.pcsPerBundle) : [dm.bundles && dm.bundles + ' bd', dm.kg && dm.kg + ' kg', dm.pieces && dm.pieces + ' pcs'].filter(Boolean).join(' '), type: clip_(l.damaged.type, 40) || 'Other' } : null;
    if (!comparable(l, s.uom)) { rows.push({ s: s, counted: '', diff: '', status: '', cmp: false, dmg: dmg }); return; }
    const counted = countedQty(l, s.uom, s.pcsPerBundle);
    const diff = counted - s.book;
    const status = statusOf(diff, st.tol);
    if (status === 'SHORT' || (status === 'OVER' && worst !== 'SHORT')) worst = status;
    rows.push({ s: s, counted: counted, diff: diff, status: status, cmp: true, dmg: dmg });
  });
  // No photo rule for now: Kim's Counts tab has no Diff / Status / Photo columns (13 Nov). A photo is still saved when one is sent.

  const now = new Date();
  const id = 'SC' + fmt_(now, 'yyMMddHHmmss') + '-' + Utilities.getUuid().slice(0, 4).toUpperCase();
  const photo = c.photo ? savePhoto_(id, c.photo) : '';
  const cnt = sheet_(SH.CNT, CNT_COLS);
  const stk = sheet_(SH.STK, STK_COLS);
  rows.forEach((r, i) => {
    const l = lines[i];
    const num = v => (v === '' || v == null ? '' : Number(v));
    appendCount_(cnt, { id: id, type: 'Count', now: now, bin: b.bin, s: r.s, bundles: num(l.bundles), kg: num(l.kg), pieces: num(l.pieces),
      counted: r.counted, diff: r.diff, status: r.status, photo: photo, by: name_(who, user), remark: clip_(l.remark, 200), note: clip_(c.note, 200),
      dmgQty: r.dmg ? r.dmg.qty : '', dmgType: r.dmg ? r.dmg.type : '' });
    addCounted_(stk, r.s, l, now, name_(who, user));   // latest count replaces the old one in Stock On Hand; Book Qty is not changed by a count
  });
  markBin_(b.bin, fmt_(now, 'yyyy-MM-dd HH:mm'), rows.some(r => r.cmp) ? worst : '');
  const hist = history_();
  return { id: id, status: worst, lines: rows.map(r => ({ material: r.s.material, desc: r.s.desc, uom: r.s.uom, book: r.s.book, counted: r.cmp ? r.counted : null, diff: r.cmp ? r.diff : null, status: r.status })),
    accuracy: accuracyPct(hist[b.bin] || [], st.win) };
}

// ---------------------------------------------------------------- stock out (Out Qty per SKU line of a bin)
function out_(user, c) {
  counter_(user);
  const bin = String(c.bin || '').trim();
  const b = bins_().find(x => x.bin.toUpperCase() === bin.toUpperCase());
  if (!b) fail_('NOBIN', 'Bin not found or not active in Bin Master.', 'រកមិនឃើញទីតាំងនេះក្នុងបញ្ជីទេ។');
  const stock = stock_(b.bin);
  const lines = (Array.isArray(c.lines) ? c.lines : []).filter(l => Number(l.outQty) > 0);
  if (!lines.length) fail_('BAD', 'Enter an Out Qty for at least one line.');
  const now = new Date();
  const id = 'OUT' + fmt_(now, 'yyMMddHHmmss') + '-' + Utilities.getUuid().slice(0, 4).toUpperCase();
  const cnt = sheet_(SH.CNT, CNT_COLS);
  const stk = sheet_(SH.STK, STK_COLS);
  const plan = lines.map(l => {
    const s = stock.find(x => lineKey_(Object.assign({ bin: b.bin }, x)) === lineKey_(Object.assign({ bin: b.bin }, l)));
    if (!s) fail_('NOLINE', 'Material ' + l.material + ' is not in this bin.');
    const out = Number(l.outQty);
    const bad = outOk(out, s.book);
    if (bad) fail_('BAD', bad);
    return { s: s, out: out };
  });
  plan.forEach(p => {
    appendCount_(cnt, { id: id, type: 'Out', now: now, bin: b.bin, s: p.s, out: p.out, by: user.email, note: clip_(c.note, 200) });
    setBook_(stk, p.s, p.s.book - p.out);   // book qty changes right away
  });
  return { id: id, lines: plan.map(p => ({ material: p.s.material, desc: p.s.desc, out: p.out, after: p.s.book - p.out })) };
}

// Adds one row to Counts, matching each value to its column by header name (new names and the old ones).
// A value whose column is not in the sheet is simply not saved. Without a Note column, the note goes into Remark.
function appendCount_(sh, r) {
  const head = sh.getRange(1, 1, 1, Math.max(sh.getLastColumn(), 1)).getDisplayValues()[0].map(h => String(h).trim().toLowerCase());
  if (r.dmgType) ['Damaged Qty', 'Damage Type'].forEach(h => { if (head.indexOf(h.toLowerCase()) < 0) { sh.getRange(1, head.length + 1).setValue(h); head.push(h.toLowerCase()); } });
  const hasNote = head.indexOf('note') >= 0;
  const v = {
    'count id': r.id, 'type': r.type, 'date': fmt_(r.now, 'yyyy-MM-dd'), 'time': fmt_(r.now, 'HH:mm'), 'bin': r.bin,
    'sku': r.s.material, 'material': r.s.material, 'description': r.s.desc, 'batch no': r.s.batch, 'batch': r.s.batch, 'sloc': r.s.sloc,
    'on hand': r.s.book, 'book qty': r.s.book, 'oh uom': r.s.uom,
    'counted qty bundle': r.bundles, 'bundle': r.bundles, 'counted qty kg': r.kg, 'kg': r.kg, 'counted qty pcs': r.pieces, 'pcs': r.pieces,
    'counted qty': r.counted, 'out qty': r.out, 'diff': r.diff, 'status': r.status, 'photo': r.photo,
    'remark': hasNote ? r.remark : [r.remark, r.note].filter(Boolean).join(' | '), 'note': r.note, 'counted by': r.by,
    'damaged qty': r.dmgQty, 'damage type': r.dmgType,
  };
  sh.appendRow(head.map(h => (v[h] == null ? '' : v[h])));
}

// ---------------------------------------------------------------- digital stock card: In / Out / Transfer + history
const activeBin_ = code => {
  const bin = String(code || '').trim();
  const b = bins_().find(x => x.bin.toUpperCase() === bin.toUpperCase());
  if (!b) fail_('NOBIN', 'Bin not found or not active in Bin Master: ' + bin, 'រកមិនឃើញទីតាំងនេះក្នុងបញ្ជីទេ៖ ' + bin);
  return b;
};
const findLine_ = (stock, bin, l) => stock.find(x => lineKey_(Object.assign({}, x, { bin: bin })) === lineKey_({ bin: bin, material: String(l.material || '').trim(), batch: String(l.batch || '').trim(), sloc: String(l.sloc || '').trim() }));
const txnId_ = (prefix, now) => prefix + fmt_(now, 'yyMMddHHmmss') + '-' + Utilities.getUuid().slice(0, 4).toUpperCase();

// A request already posted (the user tapped Save twice, or the phone re-sent a saved movement) is answered again, not posted again.
function posted_(requestId) {
  const id = clip_(requestId, 80);
  if (!id) fail_('BAD', 'Missing request id.');
  const rows = objs_(SH.LED, LED_COLS).filter(r => r['Request ID'] === id);
  return rows.length ? { id: rows[0]['Transfer ID'] || rows[0]['Txn ID'], balance: num_(rows[0].Balance), duplicate: true } : null;
}

// Adds ledger rows in one write, matched to the sheet's columns by header name.
function ledgerAppend_(rows) {
  const sh = sheet_(SH.LED, LED_COLS);
  const head = sh.getRange(1, 1, 1, Math.max(sh.getLastColumn(), 1)).getDisplayValues()[0].map(h => String(h).trim());
  LED_COLS.filter(c => head.indexOf(c) < 0 && rows.some(r => r[c] != null && r[c] !== '')).forEach(c => { sh.getRange(1, head.length + 1).setValue(c); head.push(c); });
  sh.getRange(sh.getLastRow() + 1, 1, rows.length, head.length).setValues(rows.map(r => head.map(h => (r[h] == null ? '' : r[h]))));
}
const ledgerRow_ = (id, now, type, bin, s, qty, balance, extra) => Object.assign({ 'Txn ID': id, Date: fmt_(now, 'yyyy-MM-dd'), Time: fmt_(now, 'HH:mm'), Type: type,
  Bin: bin, Material: s.material, Description: s.desc, Batch: s.batch, SLOC: s.sloc, UoM: s.uom,
  In: type === 'IN' || type === 'TRANSFER IN' ? qty : '', Out: type === 'OUT' || type === 'TRANSFER OUT' ? qty : '', Balance: balance }, extra);

// A new stock line in a bin. The material must be in Stock On Hand or in the Product Master (description, unit and
// pcs per bundle are copied); only an admin may bring in a material neither list has, and must give its description and unit.
function newLine_(who, bin, p) {
  const material = clip_(p.material, 40);
  if (!material) fail_('BAD', 'Choose a stock line or enter the material code.');
  const known = stock_('').find(x => x.material.toUpperCase() === material.toUpperCase());
  const m = pm_()[material.toUpperCase()];
  if (!known && !m && !who.admin) fail_('NOMAT', 'Material ' + material + ' is not in the Product Master. Ask an admin to add it.', 'សម្ភារៈ ' + material + ' មិនមានក្នុង Product Master ទេ។ សូមស្នើអ្នកគ្រប់គ្រងបន្ថែម។');
  const desc = known ? known.desc : m && m.desc ? m.desc : clip_(p.desc, 120);
  if (!desc) fail_('BAD', 'Enter the description for a new material.');
  const s = { bin: bin, material: known ? known.material : m ? m.material : material, desc: desc, batch: clip_(p.batch, 40), sloc: clip_(p.sloc, 20),
    uom: known ? known.uom : (m && m.uom) || clip_(p.uom, 10).toUpperCase() || 'PC',
    pcsPerBundle: known ? known.pcsPerBundle : (m && m.ppb) || 1, kgPerPc: m ? m.kg : 0, book: 0 };
  sheet_(SH.STK, STK_COLS).appendRow([s.bin, s.material, s.desc, s.batch, s.sloc, s.uom, s.pcsPerBundle, 0]);
  return s;
}

// Stock IN or Stock OUT on one line of a bin. Reference document is optional (field hidden, Kim 20 Nov 2026).
function move_(user, p) {
  const who = counter_(user);
  const dup = posted_(p.requestId);
  if (dup) return dup;
  const type = String(p.type || '').toUpperCase();
  if (type !== 'IN' && type !== 'OUT') fail_('BAD', 'Unknown movement type.');
  const reference = clip_(p.reference, 60);
  const b = activeBin_(p.bin);
  let s = findLine_(stock_(b.bin), b.bin, p);
  if (!s && type === 'OUT') fail_('NOLINE', 'This material and batch is not in this bin.', 'សម្ភារៈ និងបាច់នេះមិនមានក្នុងទីតាំងនេះទេ។');
  const pmU = s ? '' : ((pm_()[String(p.material || '').toUpperCase()] || {}).uom || '');
  const bad = moveOk(type, p.qty, s ? s.book : 0, s ? s.uom : (pmU || p.uom || 'PC'));
  if (bad) fail_('BAD', bad);
  if (!s) s = newLine_(who, b.bin, p);
  const qty = Number(p.qty), now = new Date(), id = txnId_(type === 'IN' ? 'IN' : 'OUT', now), balance = balanceAfter(type, qty, s.book);
  ledgerAppend_([ledgerRow_(id, now, type, b.bin, s, qty, balance, { Reference: reference, Remark: clip_(p.remark, 200), User: name_(who, user), 'Request ID': clip_(p.requestId, 80) })]);
  setBook_(sheet_(SH.STK, STK_COLS), s, balance);
  return { id: id, balance: balance, uom: s.uom };
}

// Moves stock of one line to another bin. Everything is checked first; then both ledger rows are written in one write
// (one Transfer ID), then the two balances. Runs under the script lock, so two phones cannot move the same stock at once.
function transfer_(user, p) {
  const who = counter_(user);
  const dup = posted_(p.requestId);
  if (dup) return dup;
  const from = activeBin_(p.bin);
  const badBin = transferOk(from.bin, p.toBin);
  if (badBin) fail_('BAD', badBin);
  const to = activeBin_(p.toBin);
  const s = findLine_(stock_(from.bin), from.bin, p);
  if (!s) fail_('NOLINE', 'This material and batch is not in the source bin.', 'សម្ភារៈ និងបាច់នេះមិនមានក្នុងទីតាំងដើមទេ។');
  const bad = moveOk('TRANSFER', p.qty, s.book, s.uom);
  if (bad) fail_('BAD', bad);
  const qty = Number(p.qty), now = new Date(), tid = txnId_('TR', now);
  const stk = sheet_(SH.STK, STK_COLS);
  let d = findLine_(stock_(to.bin), to.bin, s);
  if (!d) { d = Object.assign({}, s, { bin: to.bin, book: 0 }); stk.appendRow([d.bin, d.material, d.desc, d.batch, d.sloc, d.uom, d.pcsPerBundle, 0]); }
  const fromBal = balanceAfter('TRANSFER OUT', qty, s.book), toBal = balanceAfter('TRANSFER IN', qty, d.book);
  const extra = other => ({ Reference: clip_(p.reference, 60), 'Other Bin': other, 'Transfer ID': tid, Remark: clip_(p.remark, 200), User: name_(who, user), 'Request ID': clip_(p.requestId, 80) });
  ledgerAppend_([ledgerRow_(tid + '-O', now, 'TRANSFER OUT', from.bin, s, qty, fromBal, extra(to.bin)),
    ledgerRow_(tid + '-I', now, 'TRANSFER IN', to.bin, d, qty, toBal, extra(from.bin))]);
  setBook_(stk, s, fromBal);
  setBook_(stk, d, toBal);
  return { id: tid, balance: fromBal, toBalance: toBal, toBin: to.bin, uom: s.uom };
}

// Stock card of one line: its balance and its movements, newest first (last 200).
function card_(user, p) {
  counter_(user);
  const b = activeBin_(p.bin);
  const s = findLine_(stock_(b.bin), b.bin, p);
  if (!s) fail_('NOLINE', 'This material and batch is not in this bin.');
  const key = lineKey_(s);
  const rows = objs_(SH.LED, LED_COLS).filter(r => lineKey_({ bin: r.Bin, material: r.Material, batch: r.Batch, sloc: r.SLOC }) === key);
  return { line: s, rows: rows.slice(-200).reverse().map(ledRow_) };
}

// Admin fix of one stock line (Kim, 19 Nov, option 2): change batch / SLOC / balance, or delete the line.
// A balance change is an ADJUST row in the Stock Ledger (old rows are never changed); a reason is required.
// Delete first adjusts the balance to 0, then removes the Stock On Hand row.
function editLine_(user, p) {
  const who = counter_(user);
  if (!who.admin) fail_('ADMIN', 'Only an admin can edit or delete a stock line.', 'មានតែអ្នកគ្រប់គ្រងទេ ដែលអាចកែ ឬលុបបាន។');
  const dup = posted_(p.requestId);
  if (dup) return dup;
  const reason = clip_(p.reason, 200);
  if (!reason) fail_('BAD', 'Enter the reason.', 'សូមបញ្ចូលមូលហេតុ។');
  const b = activeBin_(p.bin);
  const s = findLine_(stock_(b.bin), b.bin, p);
  if (!s) fail_('NOLINE', 'This material and batch is not in this bin.', 'សម្ភារៈ និងបាច់នេះមិនមានក្នុងទីតាំងនេះទេ។');
  const del = p.delete === true || p.delete === 'true';
  const bal = del ? 0 : Number(p.balance);
  if (!isFinite(bal) || bal < 0) fail_('BAD', 'Balance must be 0 or more.', 'សមតុល្យត្រូវ 0 ឬច្រើនជាងនេះ។');
  if (!/^(kg|kgs|ton|t)$/i.test(String(s.uom || '').trim()) && Math.floor(bal) !== bal) fail_('BAD', 'Balance must be a whole number.', 'សមតុល្យត្រូវជាលេខគត់។');
  const n = del ? s : Object.assign({}, s, { batch: p.newBatch == null ? s.batch : clip_(p.newBatch, 40), sloc: p.newSloc == null ? s.sloc : clip_(p.newSloc, 20) });
  const moved = lineKey_(n) !== lineKey_(s);
  if (moved && findLine_(stock_(b.bin), b.bin, n)) fail_('BAD', 'This bin already has a line with that batch and SLOC.', 'ទីតាំងនេះមានបាច់ និង SLOC នេះរួចហើយ។');
  const diff = Math.round((bal - s.book) * 1000) / 1000;
  if (!diff && !moved && !del) fail_('BAD', 'Nothing changed.', 'មិនមានការផ្លាស់ប្តូរទេ។');
  const sh = sheet_(SH.STK, STK_COLS), last = sh.getLastRow();
  const v = last < 2 ? [] : sh.getRange(2, 1, last - 1, 5).getDisplayValues();
  const row = v.findIndex(r => lineKey_({ bin: r[0], material: r[1], batch: r[3], sloc: r[4] }) === lineKey_(s)) + 2;
  if (row < 2) fail_('NOLINE', 'This line is not in Stock On Hand.');
  const now = new Date(), id = txnId_('ADJ', now);
  const note = [del ? 'Deleted line' : '', moved ? 'Batch/SLOC ' + s.batch + ' / ' + s.sloc + ' -> ' + n.batch + ' / ' + n.sloc : '', reason].filter(Boolean).join(' · ');
  ledgerAppend_([ledgerRow_(id, now, 'ADJUST', b.bin, n, 0, bal, { In: diff > 0 ? diff : '', Out: diff < 0 ? -diff : '', Remark: note, User: name_(who, user), 'Request ID': clip_(p.requestId, 80) })]);
  if (del) sh.deleteRow(row);
  else {
    if (moved) sh.getRange(row, 4, 1, 2).setValues([[n.batch, n.sloc]]);
    if (diff) sh.getRange(row, 8).setValue(bal);
  }
  return { id: id, balance: bal, deleted: del, batch: n.batch, sloc: n.sloc };
}

// ---------------------------------------------------------------- fix a wrong movement (Kim, 27 Nov, question 2)
// Reverse = a REVERSAL row that cancels the movement (both legs of a transfer); the old row is never changed or deleted.
// Users fix only their own movements of today; admins and supervisors any. Undo within 5 minutes needs no reason.
function reverse_(user, p) {
  const who = counter_(user), by = name_(who, user);
  const dup = posted_(p.requestId);
  if (dup) return dup;
  const id = clip_(p.id, 60);
  const all = objs_(SH.LED, LED_COLS);
  let rows = all.filter(r => r['Txn ID'] === id || (r['Transfer ID'] && r['Transfer ID'] === id));
  if (rows.length === 1 && rows[0]['Transfer ID']) rows = all.filter(r => r['Transfer ID'] === rows[0]['Transfer ID']);
  if (!id || !rows.length) fail_('BAD', 'This movement is not in the Stock Ledger.', 'រកមិនឃើញចលនានេះក្នុងបញ្ជីទេ។');
  if (rows.some(r => !/^(IN|OUT|TRANSFER IN|TRANSFER OUT)$/i.test(r.Type))) fail_('BAD', 'Only Stock IN, OUT and Transfer can be reversed. Use Edit on the stock line.', 'អាចកែបានតែ ចូល ចេញ និងផ្ទេរ។ សូមប្រើ កែ លើបន្ទាត់ស្តុក។');
  const ids = rows.map(r => r['Txn ID']);
  if (all.some(r => ids.indexOf(String(r.Reverses || '')) >= 0)) fail_('BAD', 'This movement was already reversed.', 'ចលនានេះបានកែរួចហើយ។');
  const now = new Date(), boss = !!(who.admin || who.supervisor);
  if (!boss && rows[0].User !== by) fail_('NOACCESS', 'You can fix only your own movements. Ask a supervisor.', 'អ្នកអាចកែបានតែចលនារបស់ខ្លួនឯង។ សូមស្នើប្រធានក្រុម។');
  if (!boss && rows[0].Date !== fmt_(now, 'yyyy-MM-dd')) fail_('NOACCESS', 'You can fix only movements of today. Ask a supervisor.', 'អ្នកអាចកែបានតែចលនាថ្ងៃនេះ។ សូមស្នើប្រធានក្រុម។');
  const mins = (fmt_(now, 'HH:mm').split(':').reduce((a, x) => a * 60 + Number(x), 0)) - (String(rows[0].Time).split(':').reduce((a, x) => a * 60 + Number(x), 0));
  const undo = (p.undo === true || p.undo === 'true') && rows[0].Date === fmt_(now, 'yyyy-MM-dd') && mins >= 0 && mins <= 5;
  const reason = clip_(p.reason, 200) || (undo ? 'Undo' : '');
  if (!reason) fail_('BAD', 'Enter the reason.', 'សូមបញ្ចូលមូលហេតុ។');
  // Check every line first (no negative stock), then write all rows in one go.
  const stk = sheet_(SH.STK, STK_COLS), plan = [];
  rows.forEach(r => {
    const s = findLine_(stock_(r.Bin), r.Bin, { material: r.Material, batch: r.Batch, sloc: r.SLOC });
    if (!s) fail_('NOLINE', 'Line ' + r.Material + ' is no longer in bin ' + r.Bin + '.', 'បន្ទាត់ ' + r.Material + ' លែងមានក្នុង ' + r.Bin + '។');
    const delta = Math.round((num_(r.Out) - num_(r.In)) * 1000) / 1000, bal = Math.round((Number(s.book) + delta) * 1000) / 1000;
    if (bal < 0) fail_('BAD', 'Not enough stock in ' + r.Bin + ' to reverse this (it was already moved out).', 'ស្តុកក្នុង ' + r.Bin + ' មិនគ្រប់ដើម្បីកែ (បានចេញរួច)។');
    plan.push({ r: r, s: s, delta: delta, bal: bal });
  });
  const rid = txnId_('REV', now);
  ledgerAppend_(plan.map((x, i) => ledgerRow_(rid + (plan.length > 1 ? '-' + (i + 1) : ''), now, 'REVERSAL', x.r.Bin, x.s, 0, x.bal,
    { In: x.delta > 0 ? x.delta : '', Out: x.delta < 0 ? -x.delta : '', Reference: x.r.Reference, 'Other Bin': x.r['Other Bin'], Remark: '↶ ' + x.r['Txn ID'] + ' · ' + reason,
      User: by, 'Request ID': clip_(p.requestId, 80), Reverses: x.r['Txn ID'] })));
  plan.forEach(x => setBook_(stk, x.s, x.bal));
  return { id: rid, reversed: ids, balances: plan.map(x => ({ bin: x.r.Bin, material: x.s.material, batch: x.s.batch, sloc: x.s.sloc, balance: x.bal })) };
}

// ---------------------------------------------------------------- MB51 compare: Confirm GI (Kim, 27 Nov, points 12-13)
// Ticked compare lines are saved once to GI Reconciliation; the GI Status column reads them back by key (reference|material|batch).
const GI_COLS = ['GI ID', 'Confirmed At', 'Confirmed By', 'MB51 File', 'Key', 'Posting Date', 'Reference', 'Mat. Doc', 'Mvt', 'Material', 'Description',
  'Batch', 'Bin', 'SLoc', 'App Qty', 'MB51 Qty', 'Diff', 'UoM', 'Result', 'Remark'];
function giConfirm_(user, p) {
  const who = counter_(user), by = name_(who, user);
  const lines = Array.isArray(p.lines) ? p.lines.slice(0, 3000) : [];
  if (!lines.length) fail_('BAD', 'Tick at least one line.', 'សូមធីកយ៉ាងហោចណាស់មួយបន្ទាត់។');
  const have = {}; objs_(SH.GI, GI_COLS).forEach(r => { have[String(r.Key).toUpperCase()] = 1; });
  const now = new Date(), at = fmt_(now, 'yyyy-MM-dd HH:mm'), gid = txnId_('GI', now), add = [];
  lines.forEach(l => {
    const key = clip_(l.key, 160).toUpperCase();
    if (!key || have[key]) return;
    have[key] = 1;
    const n = v => (v === '' || v == null ? '' : num_(v));
    add.push({ 'GI ID': gid, 'Confirmed At': at, 'Confirmed By': by, 'MB51 File': clip_(p.file, 120), Key: key, 'Posting Date': clip_(l.post, 20), Reference: clip_(l.ref, 60),
      'Mat. Doc': clip_(l.doc, 40), Mvt: clip_(l.mvt, 10), Material: clip_(l.material, 40), Description: clip_(l.desc, 120), Batch: clip_(l.batch, 40), Bin: clip_(l.bin, 80),
      SLoc: clip_(l.sloc, 20), 'App Qty': n(l.appQty), 'MB51 Qty': n(l.sapQty), Diff: n(l.diff), UoM: clip_(l.uom, 10), Result: clip_(l.result, 30), Remark: clip_(l.remark, 120) });
  });
  if (add.length) {
    const sh = sheet_(SH.GI, GI_COLS);
    const head = sh.getRange(1, 1, 1, Math.max(sh.getLastColumn(), 1)).getDisplayValues()[0].map(h => String(h).trim());
    sh.getRange(sh.getLastRow() + 1, 1, add.length, head.length).setValues(add.map(r => head.map(h => (r[h] == null ? '' : r[h]))));
  }
  return { id: gid, added: add.length, skipped: lines.length - add.length, at: at, by: by };
}
function giList_(user) {
  counter_(user);
  return { rows: objs_(SH.GI, GI_COLS).slice(-20000).map(r => ({ key: r.Key, at: r['Confirmed At'], by: r['Confirmed By'], file: r['MB51 File'] })) };
}

// Writes the latest count into the Stock On Hand row of this line (Kim, 19 Nov): a new count REPLACES the old
// Counted Qty Bundle / Kg / Pcs (no more adding up) and stamps Count Date + Count Time. Every count stays in the
// Counts tab, which is the history. Total Counted Qty Kg = the Kg total, Difference = counted - Book Qty.
// Columns are found by header name; Count Date / Count Time are added at the end of the header if missing.
function addCounted_(sh, s, l, now, by) {
  const last = sh.getLastRow();
  if (last < 2) return;
  let head = sh.getRange(1, 1, 1, sh.getLastColumn()).getDisplayValues()[0].map(h => String(h).trim().toLowerCase());
  ['Count Date', 'Count Time', 'Counted Qty', 'Counted By'].forEach(h => {
    if (head.indexOf(h.toLowerCase()) < 0) { sh.getRange(1, head.length + 1).setValue(h); head.push(h.toLowerCase()); }
  });
  const col = n => head.indexOf(n) + 1;
  const v = sh.getRange(2, 1, last - 1, 5).getDisplayValues();
  const i = v.findIndex(r => lineKey_({ bin: r[0], material: r[1], batch: r[3], sloc: r[4] }) === lineKey_({ bin: s.bin, material: s.material, batch: s.batch, sloc: s.sloc }));
  if (i < 0) return;
  const row = i + 2;
  const put = (name, x) => {
    const c = col(name), val = (x === '' || x == null) ? '' : Number(x);
    if (c) sh.getRange(row, c).setValue(val);
    return val === '' ? 0 : val;
  };
  const tot = { bundles: put('counted qty bundle', l.bundles), kg: put('counted qty kg', l.kg), pieces: put('counted qty pcs', l.pieces) };
  // Total kg = kg counted + bundles and pieces turned into kg with the Product Master. Difference is in the book unit.
  if (col('total counted qty kg')) sh.getRange(row, col('total counted qty kg')).setValue(countedKg(tot, s.pcsPerBundle, s.kgPerPc));
  const diff = countDiff(tot, s.uom, s.pcsPerBundle, s.kgPerPc, s.book);
  if (col('difference')) sh.getRange(row, col('difference')).setValue(diff);
  const t = now || new Date();
  sh.getRange(row, col('count date')).setValue(fmt_(t, 'yyyy-MM-dd'));
  sh.getRange(row, col('count time')).setValue(fmt_(t, 'HH:mm'));
  // Counted Qty in the book unit (Kim, 20 Nov) = book at the count + difference; Counted By = the counter's name.
  sh.getRange(row, col('counted qty')).setValue(Math.round((Number(s.book) + Number(diff)) * 1000) / 1000);
  sh.getRange(row, col('counted by')).setValue(by || '');
}

// Writes the new book qty into the Stock On Hand row of this line.
function setBook_(sh, s, qty) {
  const last = sh.getLastRow();
  if (last < 2) return;
  const v = sh.getRange(2, 1, last - 1, 5).getDisplayValues();
  const i = v.findIndex(r => lineKey_({ bin: r[0], material: r[1], batch: r[3], sloc: r[4] }) === lineKey_({ bin: s.bin, material: s.material, batch: s.batch, sloc: s.sloc }));
  if (i >= 0) sh.getRange(i + 2, 8).setValue(qty);
}

function savePhoto_(id, dataUrl) {
  const m = String(dataUrl).match(/^data:image\/(jpeg|png);base64,([A-Za-z0-9+/=]+)$/);
  if (!m) fail_('BAD', 'Photo must be a JPEG or PNG image.');
  const bytes = Utilities.base64Decode(m[2]);
  if (bytes.length > MAX_PHOTO_BYTES) fail_('BAD', 'Photo is too large. Try again.');
  const blob = Utilities.newBlob(bytes, 'image/' + m[1], id + '.' + (m[1] === 'png' ? 'png' : 'jpg'));
  return DriveApp.getFolderById(prop_('SC_FOLDER_ID')).createFile(blob).getUrl();
}

// Writes the last count date and status into the Bin Master row (book qty lives in Stock On Hand).
function markBin_(bin, when, status) {
  const d = binRows_(), c = binHead_(d.head);
  if (c.code < 0 || c.last < 0 || c.status < 0) return;
  const i = d.rows.findIndex(r => String(r[c.code]).trim().toUpperCase() === bin.toUpperCase());
  if (i < 0) return;
  d.sh.getRange(i + 2, c.last + 1, 1, 1).setValue(when);
  d.sh.getRange(i + 2, c.status + 1, 1, 1).setValue(status);
}
