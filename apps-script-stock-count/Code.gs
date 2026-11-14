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

const SH = { BIN: 'Bin Master', STK: 'Stock On Hand', CNT: 'Counts', SET: 'Settings', LED: 'Stock Ledger', PM: 'Product Master' };
// Product Master = pipe materials with pieces per bundle and kg per piece (from Kim's Product Master file). It turns a count in
// bundles / pieces into kg. Filled once from ProductMaster.gs when the tab is empty; after that the tab is edited by hand.
const PM_COLS = ['Material', 'Description', 'Pipe Size', 'Pcs per Bundle', 'Kg per Pc', 'Source'];
// Stock Ledger = the digital stock card: one row per posted movement (In, Out, Transfer Out, Transfer In). Rows are never edited
// or deleted by the app; a correction is a new movement. Book Qty in Stock On Hand is the running balance of each line.
const LED_COLS = ['Txn ID', 'Date', 'Time', 'Type', 'Bin', 'Material', 'Description', 'Batch', 'SLOC', 'UoM', 'In', 'Out', 'Balance',
  'Reference', 'Other Bin', 'Transfer ID', 'Remark', 'User', 'Request ID'];
// Bin Master = bin master data only (bin, warehouse, active). Stock On Hand = what is in each bin (from MB52): book qty per SKU, batch and SLOC.
const BIN_COLS = ['Bin', 'Warehouse', 'Active', 'Last Count', 'Last Status'];
const STK_COLS = ['Bin', 'Material', 'Description', 'Batch', 'SLOC', 'UoM', 'Pcs per Bundle', 'Book Qty',
  'Counted Qty Bundle', 'Counted Qty Kg', 'Counted Qty Pcs', 'Total Counted Qty Kg', 'Difference'];
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

function sheet_(name, cols, seed) {
  const ss = ss_();
  let sh = ss.getSheetByName(name);
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
  const e = c('Email'), n = c('Name'), r = c('Role'), a = c('Active'), tick = c(APP_COL);
  const row = v.slice(1).find(x => e >= 0 && String(x[e]).trim().toLowerCase() === user.email);
  const admin = !!row && r >= 0 && /admin/i.test(String(row[r]));
  const ok = !!row && (a < 0 || yes_(row[a])) && (admin || (tick >= 0 && yes_(row[tick])));
  if (!ok) fail_('NOACCESS', 'Your account is not allowed to count yet. Ask Kim to tick ' + APP_COL + ' in Users.',
    'គណនីរបស់អ្នកមិនទាន់មានសិទ្ធិរាប់ស្តុកទេ។ សូមស្នើអ្នកគ្រប់គ្រងធីក ' + APP_COL + ' ក្នុង Users។');
  return { Name: n >= 0 ? String(row[n]).trim() : user.email, admin: admin };
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
      pcsPerBundle: (typed > 1 ? typed : m.ppb) || typed || 1, kgPerPc: m.kg || 0, book: num_(r['Book Qty']) };
  });
}
// Product Master as { MATERIAL: { ppb, kg } }, kept 10 minutes. An empty tab is filled from PM_SEED (ProductMaster.gs) first.
function pm_() {
  const cache = CacheService.getScriptCache();
  const hit = cache.get('pm');
  if (hit) { try { return JSON.parse(hit); } catch (e) { /* read again */ } }
  const sh = sheet_(SH.PM, PM_COLS);
  if (sh.getLastRow() < 2 && typeof PM_SEED !== 'undefined' && PM_SEED.length) {
    sh.getRange(1, 1, 1, PM_COLS.length).setValues([PM_COLS]);
    sh.getRange(2, 1, PM_SEED.length, PM_COLS.length).setNumberFormat('@').setValues(PM_SEED.map(r => r.map(String)));
  }
  const out = {};
  objs_(SH.PM, PM_COLS).forEach(r => { if (r.Material) out[r.Material.toUpperCase()] = { ppb: num_(r['Pcs per Bundle']), kg: num_(r['Kg per Pc']) }; });
  try { cache.put('pm', JSON.stringify(out), 600); } catch (e) { /* too big for the cache: read each time */ }
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
  const stock = stock_(''), per = {};
  stock.forEach(l => { per[l.bin.toUpperCase()] = (per[l.bin.toUpperCase()] || 0) + 1; });
  const list = bins_().map(b => Object.assign({}, b, { accuracy: accuracyPct(hist[b.bin] || [], st.win), lines: per[b.bin.toUpperCase()] || 0 }));
  return { user: { email: user.email, name: who.Name || user.email }, settings: { tolerance: st.tol },
    today: todayList(list, st.listSize), bins: list, stock: stock, binCount: list.length, dash: dash_(stock.length, list.length) };
}

// Home numbers: bins, stock lines, movements posted today, and the last 10 movements.
function dash_(lines, bins) {
  const today = fmt_(new Date(), 'yyyy-MM-dd');
  const led = objs_(SH.LED, LED_COLS);
  const t = led.filter(r => r.Date === today);
  return { bins: bins, lines: lines, inToday: t.filter(r => r.Type === 'IN').length, outToday: t.filter(r => r.Type === 'OUT').length,
    transferToday: t.filter(r => r.Type === 'TRANSFER OUT').length, recent: led.slice(-10).reverse().map(ledRow_) };
}
const ledRow_ = r => ({ id: r['Txn ID'], date: r.Date, time: r.Time, type: r.Type, bin: r.Bin, material: r.Material, desc: r.Description, batch: r.Batch,
  sloc: r.SLOC, uom: r.UoM, qtyIn: num_(r.In), qtyOut: num_(r.Out), balance: num_(r.Balance), reference: r.Reference, otherBin: r['Other Bin'], remark: r.Remark, user: r.User });

// Movements screen: the newest 1,000 ledger rows, oldest first.
function ledger_(user) {
  counter_(user);
  return { rows: objs_(SH.LED, LED_COLS).slice(-1000).map(ledRow_) };
}

function binInfo_(user, code) {
  counter_(user);
  const st = settings_();
  const bin = String(code || '').trim();
  const b = bins_().find(x => x.bin.toUpperCase() === bin.toUpperCase());
  if (!b) fail_('NOBIN', 'Bin not found or not active in Bin Master.', 'រកមិនឃើញកុងតឺន័រនេះក្នុងបញ្ជីទេ។');
  const hist = history_();
  return { bin: b.bin, warehouse: b.warehouse, lastCount: b.lastCount, lastStatus: b.lastStatus,
    accuracy: accuracyPct(hist[b.bin] || [], st.win), lines: stock_(b.bin) };
}

// ---------------------------------------------------------------- save a count (all SKU lines of a bin, one submit)
function submit_(user, c) {
  const who = counter_(user);
  const st = settings_();
  const bin = String(c.bin || '').trim();
  const b = bins_().find(x => x.bin.toUpperCase() === bin.toUpperCase());
  if (!b) fail_('NOBIN', 'Bin not found or not active in Bin Master.', 'រកមិនឃើញកុងតឺន័រនេះក្នុងបញ្ជីទេ។');
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
    if (!comparable(l, s.uom)) { rows.push({ s: s, counted: '', diff: '', status: '', cmp: false }); return; }
    const counted = countedQty(l, s.uom, s.pcsPerBundle);
    const diff = counted - s.book;
    const status = statusOf(diff, st.tol);
    if (status === 'SHORT' || (status === 'OVER' && worst !== 'SHORT')) worst = status;
    rows.push({ s: s, counted: counted, diff: diff, status: status, cmp: true });
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
      counted: r.counted, diff: r.diff, status: r.status, photo: photo, by: name_(who, user), remark: clip_(l.remark, 200), note: clip_(c.note, 200) });
    addCounted_(stk, r.s, l);   // every count adds up in Stock On Hand; Book Qty (from MB52) is not changed by a count
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
  if (!b) fail_('NOBIN', 'Bin not found or not active in Bin Master.', 'រកមិនឃើញកុងតឺន័រនេះក្នុងបញ្ជីទេ។');
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
  const hasNote = head.indexOf('note') >= 0;
  const v = {
    'count id': r.id, 'type': r.type, 'date': fmt_(r.now, 'yyyy-MM-dd'), 'time': fmt_(r.now, 'HH:mm'), 'bin': r.bin,
    'sku': r.s.material, 'material': r.s.material, 'description': r.s.desc, 'batch no': r.s.batch, 'batch': r.s.batch, 'sloc': r.s.sloc,
    'on hand': r.s.book, 'book qty': r.s.book, 'oh uom': r.s.uom,
    'counted qty bundle': r.bundles, 'bundle': r.bundles, 'counted qty kg': r.kg, 'kg': r.kg, 'counted qty pcs': r.pieces, 'pcs': r.pieces,
    'counted qty': r.counted, 'out qty': r.out, 'diff': r.diff, 'status': r.status, 'photo': r.photo,
    'remark': hasNote ? r.remark : [r.remark, r.note].filter(Boolean).join(' | '), 'note': r.note, 'counted by': r.by,
  };
  sh.appendRow(head.map(h => (v[h] == null ? '' : v[h])));
}

// ---------------------------------------------------------------- digital stock card: In / Out / Transfer + history
const activeBin_ = code => {
  const bin = String(code || '').trim();
  const b = bins_().find(x => x.bin.toUpperCase() === bin.toUpperCase());
  if (!b) fail_('NOBIN', 'Bin not found or not active in Bin Master: ' + bin, 'រកមិនឃើញកុងតឺន័រនេះក្នុងបញ្ជីទេ៖ ' + bin);
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
  sh.getRange(sh.getLastRow() + 1, 1, rows.length, head.length).setValues(rows.map(r => head.map(h => (r[h] == null ? '' : r[h]))));
}
const ledgerRow_ = (id, now, type, bin, s, qty, balance, extra) => Object.assign({ 'Txn ID': id, Date: fmt_(now, 'yyyy-MM-dd'), Time: fmt_(now, 'HH:mm'), Type: type,
  Bin: bin, Material: s.material, Description: s.desc, Batch: s.batch, SLOC: s.sloc, UoM: s.uom,
  In: type === 'IN' || type === 'TRANSFER IN' ? qty : '', Out: type === 'OUT' || type === 'TRANSFER OUT' ? qty : '', Balance: balance }, extra);

// A new stock line in a bin. The material must already be known in Stock On Hand (its description and unit are copied);
// only an admin may bring in a material the sheet has never seen, and must give its description and unit.
function newLine_(who, bin, p) {
  const material = clip_(p.material, 40);
  if (!material) fail_('BAD', 'Choose a stock line or enter the material code.');
  const known = stock_('').find(x => x.material.toUpperCase() === material.toUpperCase());
  if (!known && !who.admin) fail_('NOMAT', 'Material ' + material + ' is not in Stock On Hand. Ask an admin to add it.', 'សម្ភារៈ ' + material + ' មិនមានក្នុង Stock On Hand ទេ។ សូមស្នើអ្នកគ្រប់គ្រងបន្ថែម។');
  if (!known && !clip_(p.desc, 120)) fail_('BAD', 'Enter the description for a new material.');
  const s = { bin: bin, material: known ? known.material : material, desc: known ? known.desc : clip_(p.desc, 120), batch: clip_(p.batch, 40), sloc: clip_(p.sloc, 20),
    uom: known ? known.uom : (clip_(p.uom, 10) || 'PC'), pcsPerBundle: known ? known.pcsPerBundle : 1, book: 0 };
  sheet_(SH.STK, STK_COLS).appendRow([s.bin, s.material, s.desc, s.batch, s.sloc, s.uom, s.pcsPerBundle, 0]);
  return s;
}

// Stock IN or Stock OUT on one line of a bin. A reference document is required.
function move_(user, p) {
  const who = counter_(user);
  const dup = posted_(p.requestId);
  if (dup) return dup;
  const type = String(p.type || '').toUpperCase();
  if (type !== 'IN' && type !== 'OUT') fail_('BAD', 'Unknown movement type.');
  const reference = clip_(p.reference, 60);
  if (!reference) fail_('BAD', 'Enter the reference document.', 'សូមបញ្ចូលលេខឯកសារយោង។');
  const b = activeBin_(p.bin);
  let s = findLine_(stock_(b.bin), b.bin, p);
  if (!s && type === 'OUT') fail_('NOLINE', 'This material and batch is not in this bin.', 'សម្ភារៈ និងបាច់នេះមិនមានក្នុងកុងតឺន័រនេះទេ។');
  const bad = moveOk(type, p.qty, s ? s.book : 0, s ? s.uom : (p.uom || 'PC'));
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
  if (!s) fail_('NOLINE', 'This material and batch is not in the source bin.', 'សម្ភារៈ និងបាច់នេះមិនមានក្នុងកុងតឺន័រដើមទេ។');
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

// Adds one count to the Stock On Hand row of this line (Kim, 13 Nov): Counted Qty Bundle / Kg / Pcs each add up,
// Total Counted Qty Kg = the Kg total, Difference = Total Counted Qty Kg - Book Qty. Columns are found by header name.
// Clearing the three Counted cells of a row starts a new count round for it.
function addCounted_(sh, s, l) {
  const last = sh.getLastRow();
  if (last < 2) return;
  const head = sh.getRange(1, 1, 1, sh.getLastColumn()).getDisplayValues()[0].map(h => String(h).trim().toLowerCase());
  const col = n => head.indexOf(n) + 1;
  const v = sh.getRange(2, 1, last - 1, 5).getDisplayValues();
  const i = v.findIndex(r => lineKey_({ bin: r[0], material: r[1], batch: r[3], sloc: r[4] }) === lineKey_({ bin: s.bin, material: s.material, batch: s.batch, sloc: s.sloc }));
  if (i < 0) return;
  const row = i + 2;
  const add = (name, x) => {
    const c = col(name);
    if (!c || x === '' || x == null) return c ? num_(sh.getRange(row, c).getDisplayValue()) : 0;
    const total = num_(sh.getRange(row, c).getDisplayValue()) + Number(x);
    sh.getRange(row, c).setValue(total);
    return total;
  };
  const tot = { bundles: add('counted qty bundle', l.bundles), kg: add('counted qty kg', l.kg), pieces: add('counted qty pcs', l.pieces) };
  // Total kg = kg counted + bundles and pieces turned into kg with the Product Master. Difference is in the book unit.
  if (col('total counted qty kg')) sh.getRange(row, col('total counted qty kg')).setValue(countedKg(tot, s.pcsPerBundle, s.kgPerPc));
  if (col('difference')) sh.getRange(row, col('difference')).setValue(countDiff(tot, s.uom, s.pcsPerBundle, s.kgPerPc, s.book));
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
