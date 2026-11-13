/**
 * Stock Count (ការរាប់ស្តុក) — Google Apps Script backend for isteel-app.pages.dev/stock-count/.
 * Digital stock card per bin: one bin = one SKU. Replaces the paper stock card for cycle counts.
 *
 * Bound to the "SSK-STOCK-COUNT" Google Sheet (Extensions > Apps Script inside that sheet). Tabs:
 *   Bin Master  one row per bin: Bin, Warehouse, SKU, Description, UoM, Pcs per Bundle, Book Qty, Active (+ last count, filled by the app)
 *   Counts      one row per count (the history / digital stock card). Book Qty is NOT changed by a count.
 *   Who may count: the Users tab of the Fuel Refill sheet (USERS_SHEET_ID), tick box ការរាប់ស្តុក.
 *   Settings    TOLERANCE_PCS, DAILY_LIST_SIZE, ACCURACY_WINDOW
 * Drive folder "Stock Count Photos": one photo per count with a difference (SHORT or OVER).
 *
 * Script Properties (Project Settings > Script properties):
 *   GOOGLE_CLIENT_ID   same Client ID as the other iSteel apps (web/config.js)
 *   SESSION_SECRET     copy of the Fuel app's SESSION_SECRET, so one sign-in works in every app
 *   USERS_SHEET_ID     id of the Fuel Refill sheet (same as Inbound)
 *   SC_FOLDER_ID       made by setup(); Drive folder "Stock Count Photos"
 * Pure rules (countedPcs, statusOf, validateCount, accuracyPct, todayList) live in rules.gs.
 */

const SH = { BIN: 'Bin Master', CNT: 'Counts', SET: 'Settings' };
const BIN_COLS = ['Bin', 'Warehouse', 'SKU', 'Description', 'UoM', 'Pcs per Bundle', 'Book Qty', 'Active', 'Last Count', 'Last Counted Qty', 'Last Status'];
const CNT_COLS = ['Count ID', 'Date', 'Time', 'Bin', 'Warehouse', 'SKU', 'Description', 'Book Qty', 'Bundles', 'Pieces', 'Counted Qty', 'Diff', 'Status', 'Photo', 'Counted By', 'Note'];
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
  sheet_(SH.CNT, CNT_COLS);
  sheet_(SH.SET, SET_COLS, SET_SEED);
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
function counter_(user) {
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
  return { Name: n >= 0 ? String(row[n]).trim() : user.email };
}

// ---------------------------------------------------------------- data
function settings_() {
  const m = {};
  objs_(SH.SET, SET_COLS).forEach(r => { m[r.Setting] = r.Value; });
  return { tol: Number(m.TOLERANCE_PCS) || 0, listSize: Number(m.DAILY_LIST_SIZE) || 20, win: Number(m.ACCURACY_WINDOW) || 10 };
}

function bins_() {
  return objs_(SH.BIN, BIN_COLS).filter(b => b.Bin && yes_(b.Active)).map(b => ({
    bin: b.Bin, warehouse: b.Warehouse, sku: b.SKU, desc: b.Description, uom: b.UoM || 'PC',
    pcsPerBundle: Number(b['Pcs per Bundle']) || 1, book: Number(b['Book Qty']) || 0,
    lastCount: b['Last Count'] || '', lastStatus: b['Last Status'] || '', active: true,
  }));
}

// Status history per bin, in the order the counts were saved.
function history_() {
  const h = {};
  objs_(SH.CNT, CNT_COLS).forEach(r => { (h[r.Bin] = h[r.Bin] || []).push(r.Status); });
  return h;
}

function view_(b, hist, win) {
  return { bin: b.bin, warehouse: b.warehouse, sku: b.sku, desc: b.desc, uom: b.uom, pcsPerBundle: b.pcsPerBundle,
    book: b.book, lastCount: b.lastCount, lastStatus: b.lastStatus, accuracy: accuracyPct(hist[b.bin] || [], win) };
}

function boot_(user) {
  const who = counter_(user);
  const st = settings_();
  const hist = history_();
  const bins = bins_().map(b => view_(b, hist, st.win));
  return { user: { email: user.email, name: who.Name || user.email }, settings: { tolerance: st.tol },
    today: todayList(bins, st.listSize), binCount: bins.length };
}

function binInfo_(user, code) {
  counter_(user);
  const st = settings_();
  const bin = String(code || '').trim();
  const b = bins_().find(x => x.bin.toUpperCase() === bin.toUpperCase());
  if (!b) fail_('NOBIN', 'Bin not found or not active in Bin Master.', 'រកមិនឃើញកុងតឺន័រនេះក្នុងបញ្ជីទេ។');
  return view_(b, history_(), st.win);
}

// ---------------------------------------------------------------- save a count
function submit_(user, c) {
  const who = counter_(user);
  const st = settings_();
  const bin = String(c.bin || '').trim();
  const b = bins_().find(x => x.bin.toUpperCase() === bin.toUpperCase());
  if (!b) fail_('NOBIN', 'Bin not found or not active in Bin Master.', 'រកមិនឃើញកុងតឺន័រនេះក្នុងបញ្ជីទេ។');
  const bad = validateCount(c);
  if (bad) fail_('BAD', bad);

  const counted = countedPcs(c.bundles, b.pcsPerBundle, c.pieces);
  const diff = counted - b.book;
  const status = statusOf(diff, st.tol);
  if (needsPhoto(status) && !c.photo) fail_('PHOTO', 'Take a photo of the bin: the count does not match the book.', 'សូមថតរូបកុងតឺន័រ ដោយសារចំនួនមិនត្រូវនឹងសៀវភៅ។');

  const now = new Date();
  const id = 'SC' + fmt_(now, 'yyMMddHHmmss') + '-' + Utilities.getUuid().slice(0, 4).toUpperCase();
  const photo = c.photo ? savePhoto_(id, c.photo) : '';
  const when = fmt_(now, 'yyyy-MM-dd HH:mm');

  sheet_(SH.CNT, CNT_COLS).appendRow([id, fmt_(now, 'yyyy-MM-dd'), fmt_(now, 'HH:mm'), b.bin, b.warehouse, b.sku, b.desc,
    b.book, Number(c.bundles), Number(c.pieces), counted, diff, status, photo, user.email, clip_(c.note, 200)]);
  markBin_(b.bin, when, counted, status);

  const hist = history_();
  return { id: id, status: status, diff: diff, counted: counted, book: b.book, uom: b.uom, sku: b.sku, desc: b.desc,
    accuracy: accuracyPct(hist[b.bin] || [], st.win), counter: who.Name || user.email };
}

function savePhoto_(id, dataUrl) {
  const m = String(dataUrl).match(/^data:image\/(jpeg|png);base64,([A-Za-z0-9+/=]+)$/);
  if (!m) fail_('BAD', 'Photo must be a JPEG or PNG image.');
  const bytes = Utilities.base64Decode(m[2]);
  if (bytes.length > MAX_PHOTO_BYTES) fail_('BAD', 'Photo is too large. Try again.');
  const blob = Utilities.newBlob(bytes, 'image/' + m[1], id + '.' + (m[1] === 'png' ? 'png' : 'jpg'));
  return DriveApp.getFolderById(prop_('SC_FOLDER_ID')).createFile(blob).getUrl();
}

// Writes the last count into the Bin Master row (Book Qty is not changed here).
function markBin_(bin, when, counted, status) {
  const sh = sheet_(SH.BIN, BIN_COLS);
  const last = sh.getLastRow();
  if (last < 2) return;
  const bins = sh.getRange(2, 1, last - 1, 1).getDisplayValues();
  const i = bins.findIndex(r => String(r[0]).trim().toUpperCase() === bin.toUpperCase());
  if (i < 0) return;
  sh.getRange(i + 2, 9, 1, 3).setValues([[when, counted, status]]);
}
