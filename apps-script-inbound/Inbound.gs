/**
 * Inbound (ទទួលទំនិញ) — Google Apps Script backend for isteel-app.pages.dev/inbound/ (goods receipt log).
 *
 * Bound to the "SSK-INBOUND-DATA" Google Sheet (Extensions > Apps Script inside that sheet). It keeps:
 *   - "Incoming Plan" tab: Kim's Incoming Packing List (one row per PO line). Paste new shipments here.
 *   - "GR Log" tab: one row per item received (same columns as Kim's GOODS RECEIPT LOG), for filters and pivots
 *   - "Receipts" tab: one row per truck with the full receipt (JSON) the app reads back
 *   - "IB Settings" tab: Telegram chat, app address, 3PL companies
 *   - Drive folder "Inbound Photos" (one sub-folder per receipt): truck, load, document and damage photos.
 * Flow: arrival (pick a pending PO, the items on this truck, arrival qty, truck, 3PL DN, 3 photos; start time = now)
 *   -> finish (actual GR qty, damaged qty + type + photos, truck owner, manpower; end time = now).
 *
 * Script Properties (Project Settings > Script properties):
 *   GOOGLE_CLIENT_ID   same Client ID as the other iSteel apps (web/config.js)
 *   SESSION_SECRET     copy of the Fuel app's SESSION_SECRET, so one sign-in works in every app
 *   USERS_SHEET_ID     id of the Fuel Refill Google Sheet: its "Users" tab is the one user list (tick box ទទួលទំនិញ),
 *                      its "Driver & Truck" tab gives the plates
 *   TELEGRAM_BOT_TOKEN optional: copy of the Fuel app's bot token; the group's chat id goes in IB Settings
 *   IB_FOLDER_ID       made by setup(); Drive folder "Inbound Photos"
 */

const SH = { PLAN: 'Incoming Plan', LOG: 'GR Log', REC: 'Receipts', SET: 'IB Settings' };
const PLAN_COLS = ['No', 'Material', 'Description', 'Plant', 'SLOC', 'Kg', 't', 'PCS', 'Remark', 'No. of Truck', 'PO Number', 'Inbound No.', 'Ref. No', 'ETA', 'Supplier'];
const LOG_COLS = ['Receipt ID', 'Status', 'PO Number', 'Inbound Number', 'Ref. No.', 'Supplier', 'ETA', '3PL DN Number', 'Material', 'Material Description',
  'Truck Number/Trailer', 'PO Qty', 'Arrival Qty', 'Actual GR Qty', 'Damaged Qty', 'Damage Type', 'Received Less', 'UoM', 'Receipt Date', 'Start Time',
  'End Time', 'Time Spent (min)', 'Productivity (t/person/h)', 'Manpower used to Unload/Receive', 'Truck Owner', '3PL Company', 'Remark',
  'Recorded By', 'Finished By', 'Photos Folder', 'Updated'];
const REC_COLS = ['Receipt ID', 'Status', 'Receipt Date', 'PO Number', 'Truck', 'Data', 'Updated'];
const SET_COLS = ['Setting', 'Value', 'Note'];
const APP_COL = 'ទទួលទំនិញ';        // tick box column in the Fuel Refill Users tab (added by the Fuel script)
const STATUS = { live: 'Unloading', done: 'Done' };
const PHOTOS = ['front', 'load', 'doc'];
const MAX_DMG_PHOTOS = 6;
const MAX_PHOTO_BYTES = 4 * 1024 * 1024;
const MAX_ITEMS = 60;
const DMG = { dent: 'Dent', rust: 'Rust', wet: 'Wet / water', edge: 'Edge damage', scratch: 'Scratch', bent: 'Bent / out of shape',
  coat: 'Coating peeled', pack: 'Packing torn', wrong: 'Wrong item', other: 'Other' };

// ---------------------------------------------------------------- web entry points
function doGet() { return json_({ ok: true, app: 'Inbound' }); }

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
    case 'start': return start_(p.receipt || {}, user);
    case 'finish': return update_(p.receipt || {}, user, true);
    case 'save': return update_(p.receipt || {}, user, false);
    case 'photos': return photos_(p.ids);
    default: fail_('BAD', 'Unknown action');
  }
}

function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
function fail_(code, en, kh) { throw new Error(code + ': ' + en + (kh ? ' || ' + kh : '')); }
const prop_ = k => PropertiesService.getScriptProperties().getProperty(k) || '';
const TZ = 'Asia/Phnom_Penh';
const fmt_ = (d, f) => Utilities.formatDate(d, TZ, f);
const now_ = () => fmt_(new Date(), 'yyyy-MM-dd HH:mm');
const text_ = v => (v == null ? '' : v instanceof Date ? fmt_(v, 'yyyy-MM-dd HH:mm') : String(v).trim());
const yes_ = v => v === true || /^(yes|true|y|1|✓)$/i.test(String(v).trim());
const clip_ = (v, n) => String(v == null ? '' : v).trim().slice(0, n || 200);
const num_ = v => { const n = Number(String(v == null ? '' : v).replace(/,/g, '').trim()); return isFinite(n) ? n : NaN; };
const ss_ = () => SpreadsheetApp.getActive();
const esc_ = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

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
    sh.getRange(1, 1, sh.getMaxRows(), cols.length).setNumberFormat('@');   // plain text: plates like 3E-2588 stay as typed
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
  const plan = sheet_(SH.PLAN, PLAN_COLS);
  plan.getRange(1, 6, plan.getMaxRows(), 1).setNumberFormat('#,##0');   // Kg stays a number
  sheet_(SH.LOG, LOG_COLS);
  sheet_(SH.REC, REC_COLS);
  sheet_(SH.SET, SET_COLS, [
    ['TELEGRAM_CHAT_ID', '', 'Telegram group for trucks arriving and receipts with damage or short qty (the Fuel app\'s TELEGRAM_CHAT_ID works). Empty = off.'],
    ['APP_URL', 'https://isteel-app.pages.dev/inbound/', 'Address of the app, used in Telegram buttons'],
    ['THREEPL_COMPANIES', 'FOXS, Queen Legacy, Srong Sal, Chroek Kimheng', '3PL companies in the app\'s list, comma separated (people can also add new ones)'],
    ['DAYS_SHOWN', '90', 'How many days of receipts the app loads (receipts of POs still in Incoming Plan always load)'],
  ]);
  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty('IB_FOLDER_ID')) props.setProperty('IB_FOLDER_ID', DriveApp.createFolder('Inbound Photos').getId());
  const first = ss_().getSheets()[0];
  if (first && first.getName() !== SH.PLAN && first.getLastRow() === 0) ss_().deleteSheet(first);   // the empty "Sheet1"
  const notes = [];
  ['GOOGLE_CLIENT_ID', 'SESSION_SECRET', 'USERS_SHEET_ID'].forEach(k => { if (!prop_(k)) notes.push('Add ' + k + ' in Script properties.'); });
  if (!prop_('TELEGRAM_BOT_TOKEN')) notes.push('Optional: add TELEGRAM_BOT_TOKEN (copy from the Fuel app) for Telegram posts.');
  notes.push('Then: Deploy > New deployment > Web app, Execute as Me, Who has access Anyone.');
  const msg = notes.join('\n');
  console.log(msg);
  return msg;
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
  const u = usersCached_().find(x => x.email === email && x.ok);
  if (!u) fail_('NOACCESS', email + ' has no Inbound access. Ask the admin to tick ' + APP_COL + ' in Users.',
    email + ' មិនទាន់មានសិទ្ធិប្រើ ' + APP_COL + ' ទេ។ សូមស្នើអ្នកគ្រប់គ្រងធីក ' + APP_COL + ' ក្នុង Users។');
  return { email: email, name: u.name || email, admin: u.admin, reviewer: u.reviewer, session: session };
}

/** The one user list: the Users tab of the Fuel Refill sheet. Active = Yes and ទទួលទំនិញ ticked (Fuel admins always). */
function users_() {
  const id = prop_('USERS_SHEET_ID');
  if (!id) fail_('SETUP', 'USERS_SHEET_ID is missing in Script properties.');
  const sh = SpreadsheetApp.openById(id).getSheetByName('Users');
  if (!sh || sh.getLastRow() < 2) return [];
  const v = sh.getRange(1, 1, sh.getLastRow(), sh.getLastColumn()).getValues();
  const head = v[0].map(h => String(h).trim());
  const c = n => head.indexOf(n);
  const e = c('Email'), n = c('Name'), r = c('Role'), a = c('Active'), tick = c(APP_COL);
  return v.slice(1).filter(x => x[e]).map(x => {
    const role = r >= 0 ? text_(x[r]) : '';
    const admin = /admin/i.test(role);
    return { email: String(x[e]).trim().toLowerCase(), name: n >= 0 ? text_(x[n]) : '', admin: admin, reviewer: admin || /review/i.test(role),
      ok: (a < 0 || yes_(x[a])) && (admin || (tick >= 0 && yes_(x[tick]))) };
  });
}
function usersCached_() {
  const cache = CacheService.getScriptCache();
  const hit = cache.get('ib_users');
  if (hit) return JSON.parse(hit);
  const u = users_();
  try { cache.put('ib_users', JSON.stringify(u), 60); } catch (e) { /* too big: read each time */ }
  return u;
}

// ---------------------------------------------------------------- lists
function setting_(k) { const r = objs_(SH.SET, SET_COLS).find(o => o.Setting === k); return r ? r.Value : ''; }
function plates_() {
  const cache = CacheService.getScriptCache();
  const hit = cache.get('ib_plates');
  if (hit) return JSON.parse(hit);
  const out = [];
  try {
    const sh = SpreadsheetApp.openById(prop_('USERS_SHEET_ID')).getSheetByName('Driver & Truck');
    if (sh && sh.getLastRow() > 1) {
      const v = sh.getRange(1, 1, sh.getLastRow(), sh.getLastColumn()).getDisplayValues();
      const ip = v[0].map(h => String(h).trim()).indexOf('CODE');
      if (ip >= 0) v.slice(1).forEach(r => { const p = String(r[ip]).trim(); if (p && p !== '0' && out.indexOf(p) < 0) out.push(p); });
      out.sort();
    }
  } catch (e) { /* no Driver & Truck tab: plates are typed */ }
  try { cache.put('ib_plates', JSON.stringify(out), 600); } catch (e) { /* too big */ }
  return out;
}

/** Incoming Plan: one line per PO + material, read by heading names so extra columns do no harm. */
function plan_() {
  const sh = sheet_(SH.PLAN, PLAN_COLS);
  if (sh.getLastRow() < 2) return [];
  const v = sh.getRange(1, 1, sh.getLastRow(), sh.getLastColumn()).getValues();
  const head = v[0].map(h => String(h).trim().toLowerCase().replace(/\.$/, ''));
  const c = (...names) => { for (const n of names) { const i = head.indexOf(n); if (i >= 0) return i; } return -1; };
  const iPo = c('po number', 'po'), iMat = c('material'), iDesc = c('description', 'material description'), iKg = c('kg', 'qty'),
    iPcs = c('pcs'), iIn = c('inbound no', 'inbound number'), iRef = c('ref. no', 'ref no'), iEta = c('eta'), iSup = c('supplier'),
    iPlant = c('plant'), iSloc = c('sloc');
  const cell = (r, i) => (i < 0 ? '' : r[i] instanceof Date ? fmt_(r[i], 'yyyy-MM-dd') : String(r[i] == null ? '' : r[i]).trim());
  const seen = {};
  return v.slice(1).map(r => ({
    po: cell(r, iPo), material: cell(r, iMat), desc: cell(r, iDesc), kg: num_(r[iKg]), pcs: cell(r, iPcs), inbound: cell(r, iIn),
    ref: cell(r, iRef), eta: cell(r, iEta), supplier: cell(r, iSup), plant: cell(r, iPlant), sloc: cell(r, iSloc),
  })).filter(x => x.po && x.material && x.kg > 0 && !seen[x.po + '|' + x.material] && (seen[x.po + '|' + x.material] = 1));
}

// ---------------------------------------------------------------- receipts
function recRows_() {
  const sh = sheet_(SH.REC, REC_COLS);
  if (sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, REC_COLS.length).getDisplayValues();
}
function receipts_() {
  return recRows_().map(r => { try { return JSON.parse(r[5]); } catch (e) { return null; } }).filter(Boolean);
}
function boot_(user) {
  const plan = plan_();
  const pos = {}; plan.forEach(x => { pos[x.po] = 1; });
  const days = Math.max(1, num_(setting_('DAYS_SHOWN')) || 90);
  const from = fmt_(new Date(Date.now() - days * 86400000), 'yyyy-MM-dd');
  const recs = receipts_().filter(r => r.date >= from || pos[r.po]);
  const carriers = setting_('THREEPL_COMPANIES').split(',').map(s => s.trim()).filter(Boolean);
  recs.forEach(r => { if (r.carrier && carriers.indexOf(r.carrier) < 0) carriers.push(r.carrier); });
  return { user: { email: user.email, name: user.name, admin: user.admin, reviewer: user.reviewer }, plan: plan, receipts: recs, plates: plates_(), carriers: carriers };
}
function find_(id) {
  const rows = recRows_();
  const i = rows.findIndex(r => r[0] === String(id || ''));
  if (i < 0) fail_('NOTFOUND', 'Receipt not found.', 'រកមិនឃើញការទទួលនេះទេ។');
  return { row: i + 2, rec: JSON.parse(rows[i][5]) };
}
function nextId_() {
  const day = fmt_(new Date(), 'yyMMdd');
  let n = 0;
  recRows_().forEach(r => { const m = String(r[0]).match(/^IB-(\d{6})-(\d+)$/); if (m && m[1] === day) n = Math.max(n, +m[2]); });
  return 'IB-' + day + '-' + String(n + 1).padStart(2, '0');
}

// ---------------------------------------------------------------- photos (one Drive folder per receipt)
function root_() { return DriveApp.getFolderById(prop_('IB_FOLDER_ID') || fail_('SETUP', 'Run setup() first.')); }
function folder_(id) {
  const it = root_().getFoldersByName(id);
  return it.hasNext() ? it.next() : root_().createFolder(id);
}
function saveImage_(folder, dataUrl, name) {
  const m = String(dataUrl || '').match(/^data:(image\/(png|jpeg|webp));base64,(.+)$/);
  if (!m) return null;
  const bytes = Utilities.base64Decode(m[3]);
  if (bytes.length > MAX_PHOTO_BYTES) fail_('BIG', 'A photo is too big.', 'រូបថតធំពេក។');
  return folder.createFile(Utilities.newBlob(bytes, m[1], name)).getId();
}
/** A photo value from the app: a new photo (data URL) is saved; an old one (file id) is kept only if it was already on this receipt. */
function photo_(folder, v, keep, name) {
  if (/^data:image\//.test(String(v || ''))) return saveImage_(folder, v, name);
  return keep.indexOf(v) >= 0 ? v : null;
}
/** Small thumbnails for the app. Only files inside the Inbound Photos folder are read. */
function photos_(ids) {
  const rootId = root_().getId();
  const out = {};
  (Array.isArray(ids) ? ids : []).slice(0, 20).forEach(id => {
    try {
      const f = DriveApp.getFileById(String(id));
      const p = f.getParents();
      const parent = p.hasNext() ? p.next() : null;
      const gp = parent && parent.getParents();
      if (!gp || !gp.hasNext() || gp.next().getId() !== rootId) return;
      const b = f.getThumbnail() || f.getBlob();
      out[id] = 'data:' + (b.getContentType() || 'image/jpeg') + ';base64,' + Utilities.base64Encode(b.getBytes());
    } catch (e) { /* gone */ }
  });
  return out;
}

// ---------------------------------------------------------------- arrival
function start_(p, user) {
  const plan = plan_().filter(x => x.po === String(p.po || ''));
  if (!plan.length) fail_('BAD', 'This PO is not in the Incoming Plan.', 'PO នេះមិនមានក្នុងផែនការទំនិញចូលទេ។');
  const items = (Array.isArray(p.items) ? p.items : []).slice(0, MAX_ITEMS).map(i => {
    const line = plan.find(x => x.material === String(i.material || ''));
    if (!line) fail_('BAD', 'Item ' + clip_(i.material, 30) + ' is not on this PO.', 'ទំនិញ ' + clip_(i.material, 30) + ' មិនមែនរបស់ PO នេះទេ។');
    const arr = num_(i.arrQty);
    if (!(arr > 0)) fail_('BAD', 'Arrival Qty is missing for ' + line.desc + '.', 'សូមបញ្ចូលបរិមាណមកដល់សម្រាប់ ' + line.desc + '។');
    return { material: line.material, desc: line.desc, poQty: line.kg, pcs: line.pcs, arrQty: arr, grQty: '', dmgQty: '', dmgType: '', dmgPh: [] };
  });
  if (!items.length) fail_('BAD', 'Choose the items on this truck.', 'សូមជ្រើសទំនិញលើឡាននេះ។');
  const truck = clip_(p.truck, 20).toUpperCase().replace(/\s+/g, '');
  if (!truck) fail_('BAD', 'Truck number is missing.', 'សូមបញ្ចូលផ្លាកលេខឡាន។');
  const dn = clip_(p.dn3pl, 40);
  if (!dn) fail_('BAD', '3PL DN Number is missing.', 'សូមបញ្ចូលលេខ DN របស់ 3PL។');
  const ph = p.ph || {};
  if (PHOTOS.some(k => !/^data:image\//.test(String(ph[k] || '')))) fail_('BAD', 'Take the 3 photos first.', 'សូមថតរូប ៣ ជាមុនសិន។');
  return withLock_(() => {
    const id = nextId_();
    const folder = folder_(id);
    const now = new Date();
    const l = plan[0];
    const rec = {
      id: id, status: STATUS.live, po: l.po, inbound: l.inbound, ref: l.ref, supplier: l.supplier, eta: l.eta, dn3pl: dn, truck: truck,
      items: items, uom: 'Kg', date: fmt_(now, 'yyyy-MM-dd'), start: fmt_(now, 'HH:mm'), end: '', manpower: '', owner: '', carrier: '', remark: '',
      ph: { front: saveImage_(folder, ph.front, 'front.jpg'), load: saveImage_(folder, ph.load, 'load.jpg'), doc: saveImage_(folder, ph.doc, 'document.jpg') },
      by: user.name, byEmail: user.email, finishedBy: '', folder: folder.getUrl(), updated: now_(),
    };
    store_(rec);
    telegramArrived_(rec);
    return rec;
  });
}

// ---------------------------------------------------------------- finish / save
function update_(p, user, finish) {
  return withLock_(() => {
    const f = find_(p.id);
    const rec = f.rec;
    const live = rec.status === STATUS.live;
    if (!live && !(user.admin || user.reviewer || rec.byEmail === user.email)) fail_('DENIED', 'Only the person who recorded it or an admin can change it.', 'មានតែអ្នកកត់ត្រា ឬ Admin ទេដែលអាចកែបាន។');
    if (finish && !live) fail_('BAD', 'This truck is already finished.', 'ឡាននេះបានបញ្ចប់រួចហើយ។');
    const folder = folder_(rec.id);
    const sent = Array.isArray(p.items) ? p.items : [];
    rec.items.forEach(i => {
      const s = sent.find(x => String(x.material) === i.material) || {};
      const gr = s.grQty === '' || s.grQty == null ? '' : num_(s.grQty);
      const dm = s.dmgQty === '' || s.dmgQty == null ? 0 : num_(s.dmgQty);
      if (gr !== '' && !(gr >= 0)) fail_('BAD', 'Actual GR Qty must be a number.', 'បរិមាណទទួលត្រូវតែជាលេខ។');
      if (!(dm >= 0)) fail_('BAD', 'Damaged Qty must be a number.', 'បរិមាណខូចខាតត្រូវតែជាលេខ។');
      if (finish && gr === '') fail_('BAD', 'Actual GR Qty is missing for ' + i.desc + '.', 'សូមបញ្ចូលបរិមាណទទួលសម្រាប់ ' + i.desc + '។');
      i.grQty = gr;
      i.dmgQty = gr === '' && !dm ? '' : dm;
      i.dmgType = dm > 0 ? (DMG[s.dmgType] ? s.dmgType : clip_(s.dmgType, 40)) : '';
      const keep = i.dmgPh || [];
      i.dmgPh = dm > 0 ? (Array.isArray(s.dmgPh) ? s.dmgPh : []).slice(0, MAX_DMG_PHOTOS)
        .map((v, n) => photo_(folder, v, keep, 'damage-' + i.material + '-' + (n + 1) + '.jpg')).filter(Boolean) : [];
      if (finish && dm > 0 && !i.dmgType) fail_('BAD', 'Choose the damage type for ' + i.desc + '.', 'សូមជ្រើសប្រភេទខូចខាតសម្រាប់ ' + i.desc + '។');
      if (finish && dm > 0 && !i.dmgPh.length) fail_('BAD', 'Take a damage photo for ' + i.desc + '.', 'សូមថតរូបខូចខាតសម្រាប់ ' + i.desc + '។');
    });
    const truck = clip_(p.truck, 20).toUpperCase().replace(/\s+/g, '');
    if (truck) rec.truck = truck;
    if (clip_(p.dn3pl, 40)) rec.dn3pl = clip_(p.dn3pl, 40);
    rec.owner = p.owner === 'ISI' || p.owner === '3PL' ? p.owner : rec.owner;
    rec.carrier = rec.owner === '3PL' ? clip_(p.carrier, 60) : '';
    const mp = num_(p.manpower);
    rec.manpower = mp > 0 ? Math.round(mp) : rec.manpower;
    rec.remark = clip_(p.remark, 500);
    if (finish) {
      if (!rec.owner) fail_('BAD', 'Choose ISI or 3PL truck.', 'សូមជ្រើសឡាន ISI ឬ 3PL។');
      if (!(rec.manpower > 0)) fail_('BAD', 'Manpower is missing.', 'សូមបញ្ចូលចំនួនកម្មករ។');
      rec.end = fmt_(new Date(), 'HH:mm');
      rec.status = STATUS.done;
      rec.finishedBy = user.name;
    }
    rec.updated = now_();
    store_(rec, f.row);
    if (finish) telegramDone_(rec);
    return rec;
  });
}

// ---------------------------------------------------------------- sheet rows
const spent_ = r => { if (!r.start || !r.end) return ''; const a = r.start.split(':'), b = r.end.split(':'); let m = (+b[0] * 60 + +b[1]) - (+a[0] * 60 + +a[1]); if (m < 0) m += 1440; return m; };
const tot_ = (r, k) => r.items.reduce((s, i) => s + (Number(i[k]) || 0), 0);
const isLess_ = i => i.grQty !== '' && i.grQty != null && Number(i.grQty) < Number(i.arrQty);
function prod_(r) { const m = spent_(r); const t = tot_(r, 'grQty') / 1000; return m && r.manpower && t ? Math.round(t / (m / 60) / r.manpower * 100) / 100 : ''; }
const showDate_ = s => (s ? s.split('-').reverse().join('.') : '');

function store_(rec, row) {
  const data = [rec.id, rec.status, rec.date, rec.po, rec.truck, JSON.stringify(rec), rec.updated];
  const sh = sheet_(SH.REC, REC_COLS);
  sh.getRange(row || sh.getLastRow() + 1, 1, 1, data.length).setNumberFormat('@').setValues([data.map(String)]);
  writeLog_(rec);
}
/** GR Log: one row per item, in the order of Kim's GOODS RECEIPT LOG. Old rows of the receipt are replaced. */
function writeLog_(rec) {
  const sh = sheet_(SH.LOG, LOG_COLS);
  const rows = rec.items.map(i => [rec.id, rec.status, rec.po, rec.inbound, rec.ref, rec.supplier, showDate_(rec.eta), rec.dn3pl, i.material, i.desc,
    rec.truck, i.poQty, i.arrQty, i.grQty, i.dmgQty, i.dmgType ? DMG[i.dmgType] || i.dmgType : '', isLess_(i) ? 'Yes' : '', rec.uom, showDate_(rec.date),
    rec.start, rec.end, spent_(rec), prod_(rec), rec.manpower, rec.owner === 'ISI' ? 'ISI Truck' : rec.owner === '3PL' ? '3PL Truck' : '', rec.carrier, rec.remark,
    rec.by, rec.finishedBy, rec.folder, rec.updated].map(x => (x == null ? '' : String(x))));
  const last = sh.getLastRow();
  const ids = last > 1 ? sh.getRange(2, 1, last - 1, 1).getDisplayValues().map(r => r[0]) : [];
  const at = [];
  ids.forEach((id, n) => { if (id === rec.id) at.push(n + 2); });
  if (at.length === rows.length && at.every((r, n) => r === at[0] + n)) {
    sh.getRange(at[0], 1, rows.length, LOG_COLS.length).setNumberFormat('@').setValues(rows);
    return;
  }
  at.reverse().forEach(r => sh.deleteRow(r));
  sh.getRange(sh.getLastRow() + 1, 1, rows.length, LOG_COLS.length).setNumberFormat('@').setValues(rows);
}

// ---------------------------------------------------------------- Telegram
function telegram_(payload) {
  const token = prop_('TELEGRAM_BOT_TOKEN'), chat = setting_('TELEGRAM_CHAT_ID');
  if (!token || !chat) return null;
  try {
    const res = UrlFetchApp.fetch('https://api.telegram.org/bot' + token + '/sendMessage', { method: 'post', payload: Object.assign({ chat_id: chat, parse_mode: 'HTML' }, payload), muteHttpExceptions: true });
    const out = JSON.parse(res.getContentText() || '{}');
    if (!out.ok) console.error('telegram: ' + res.getContentText());
    return out;
  } catch (e) { console.error('telegram: ' + e); return null; }
}
function button_(r) { const u = setting_('APP_URL'); return u ? { reply_markup: JSON.stringify({ inline_keyboard: [[{ text: 'Open · បើក', url: u + '#/r/' + encodeURIComponent(r.id) }]] }) } : {}; }
const kg_ = n => Number(n || 0).toLocaleString('en-US');
function telegramArrived_(r) {
  telegram_(Object.assign({ text: ['🚛 <b>Truck arrived ' + esc_(r.truck) + '</b> · ' + esc_(r.start),
    '📄 ' + esc_(r.po) + ' · ' + esc_(r.supplier) + ' · DN ' + esc_(r.dn3pl),
    '📦 ' + r.items.length + ' item(s) · ' + kg_(tot_(r, 'arrQty')) + ' Kg', '✍️ ' + esc_(r.by)].join('\n') }, button_(r)));
}
/** Posted when a truck finishes with damage or a short quantity. */
function telegramDone_(r) {
  const dmg = r.items.filter(i => Number(i.dmgQty) > 0), less = r.items.filter(isLess_);
  if (!dmg.length && !less.length) return;
  const lines = ['⚠️ <b>Receipt ' + esc_(r.id) + '</b> · ' + esc_(r.truck) + ' · ' + esc_(r.po)];
  less.forEach(i => lines.push('⬇ Received less: ' + esc_(i.desc) + ' ' + kg_(i.grQty) + ' / ' + kg_(i.arrQty) + ' Kg'));
  dmg.forEach(i => lines.push('💥 Damaged: ' + esc_(i.desc) + ' ' + kg_(i.dmgQty) + ' (' + esc_(DMG[i.dmgType] || i.dmgType) + ')'));
  lines.push('✍️ ' + esc_(r.finishedBy));
  telegram_(Object.assign({ text: lines.join('\n') }, button_(r)));
}
